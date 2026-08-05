import { useEffect, useMemo, useState } from "react";
import { PackageCheck, Plus, Save, Send } from "lucide-react";
import { createDashboardSocket } from "../../lib/socket";
import { getGuildLiveOptions, getWeaponSales, publishWeaponSalePanel, saveWeaponSaleConfig } from "../../lib/api";
import type { DashboardGuild, GuildCategoryOption, GuildChannelOption, GuildRoleOption, WeaponSaleConfig, WeaponSaleDashboard, WeaponSaleWeapon } from "../../types";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { FivemResourceMultiSelect, FivemResourceSelect } from "./FivemResourceSelect";

export function WeaponSalesPanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [categories, setCategories] = useState<GuildCategoryOption[]>([]);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [dashboard, setDashboard] = useState<WeaponSaleDashboard | null>(null);
  const [draft, setDraft] = useState<Partial<WeaponSaleConfig>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [weapons, setWeapons] = useState<Array<Partial<WeaponSaleWeapon> & { name: string; unitPriceInCents: number }>>([]);

  function load() {
    if (!guild) return Promise.resolve();
    return Promise.all([getWeaponSales(guild.id, botId), getGuildLiveOptions(guild.id, botId)]).then(([data, live]) => {
      setDashboard(data);
      setDraft(data.config);
      setWeapons(data.weapons.map((weapon) => ({ ...weapon })));
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
    socket.on("fivem:weapons:updated", refresh);
    return () => { socket.off("fivem:weapons:updated", refresh); socket.disconnect(); };
  }, [botId, guild?.id]);

  const channelOptions = useMemo(() => channels.map((channel) => ({ id: channel.id, name: channel.name })), [channels]);
  const categoryOptions = useMemo(() => categories.map((category) => ({ id: category.id, name: category.name })), [categories]);
  const roleOptions = useMemo(() => roles.map((role) => ({ color: role.color, id: role.id, name: role.name })), [roles]);

  if (!guild) return <Card><CardContent className="p-6 text-sm text-zinc-400">Selecione um servidor para configurar o Sistema de Armas.</CardContent></Card>;
  if (!dashboard) return <Card><CardContent className="p-6 text-sm text-zinc-400">Carregando Sistema de Armas...</CardContent></Card>;

  function patch(value: Partial<WeaponSaleConfig>) { setDraft((current) => ({ ...current, ...value })); }
  function patchWeapon(index: number, value: Partial<WeaponSaleWeapon>) { setWeapons((current) => current.map((weapon, currentIndex) => currentIndex === index ? { ...weapon, ...value } : weapon)); }

  async function save() {
    if (!guild) return;
    setSaving(true);
    try {
      const config = await saveWeaponSaleConfig(guild.id, { ...draft, weapons: weapons.filter((weapon) => weapon.name.trim() && weapon.unitPriceInCents > 0) }, botId);
      setDashboard((current) => current ? { ...current, config } : current);
      await load();
      setMessage("Configuração salva.");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!guild) return;
    const config = await publishWeaponSalePanel(guild.id, botId);
    setDashboard((current) => current ? { ...current, config } : current);
    setMessage("Publicação enviada ao bot.");
  }

  return (
    <div className="space-y-4">
      {message ? <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</div> : null}
      <div className="grid gap-3 md:grid-cols-4">
        <StatusCard label="Status" value={draft.enabled ? "Ativo" : "Inativo"} />
        <StatusCard label="Armas ativas" value={String(weapons.filter((weapon) => weapon.active !== false).length)} />
        <StatusCard label="Vendas concluídas" value={String(dashboard.report.completedCount)} />
        <StatusCard label="Total vendido" value={money(dashboard.report.totalValueInCents)} />
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base"><PackageCheck className="h-4 w-4" /> Sistema de Armas</CardTitle>
          <div className="flex gap-2">
            <Button disabled={!canManage || saving} onClick={() => void save()} size="sm"><Save className="mr-2 h-4 w-4" />Salvar</Button>
            <Button disabled={!canManage || !draft.panelChannelId} onClick={() => void publish()} size="sm" variant="secondary"><Send className="mr-2 h-4 w-4" />Publicar</Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-zinc-300"><input checked={draft.enabled === true} disabled={!canManage} onChange={(event) => patch({ enabled: event.target.checked })} type="checkbox" /> Ativar módulo</label>
          <label className="grid gap-1 text-sm text-zinc-300">Título<input className="rounded-md border border-zinc-800 bg-black px-3 py-2" disabled={!canManage} onChange={(event) => patch({ title: event.target.value })} value={draft.title ?? ""} /></label>
          <label className="grid gap-1 text-sm text-zinc-300">Descrição<input className="rounded-md border border-zinc-800 bg-black px-3 py-2" disabled={!canManage} onChange={(event) => patch({ description: event.target.value })} value={draft.description ?? ""} /></label>
          <label className="grid gap-1 text-sm text-zinc-300">Texto do botão<input className="rounded-md border border-zinc-800 bg-black px-3 py-2" disabled={!canManage} onChange={(event) => patch({ buttonText: event.target.value })} value={draft.buttonText ?? ""} /></label>
          <FivemResourceSelect disabled={!canManage} label="Canal do painel" onChange={(value) => patch({ panelChannelId: value })} options={channelOptions} value={draft.panelChannelId ?? null} />
          <FivemResourceSelect disabled={!canManage} label="Canal de logs" onChange={(value) => patch({ logChannelId: value })} options={channelOptions} value={draft.logChannelId ?? null} />
          <FivemResourceSelect disabled={!canManage} label="Categoria temporária" onChange={(value) => patch({ temporaryCategoryId: value })} options={categoryOptions} value={draft.temporaryCategoryId ?? null} />
          <FivemResourceMultiSelect disabled={!canManage} label="Cargos de gerência" onChange={(values) => patch({ managerRoleIds: values })} options={roleOptions} values={draft.managerRoleIds ?? []} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Armas cadastradas</CardTitle>
          <Button disabled={!canManage} onClick={() => setWeapons((current) => [...current, { active: true, name: "", unitPriceInCents: 0 }])} size="sm" variant="secondary"><Plus className="mr-2 h-4 w-4" />Cadastrar arma</Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {weapons.map((weapon, index) => (
            <div className="grid gap-2 rounded-md border border-zinc-800 bg-black/30 p-3 md:grid-cols-[1fr_180px_auto]" key={weapon.id ?? index}>
              <input className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm" disabled={!canManage} onChange={(event) => patchWeapon(index, { name: event.target.value })} placeholder="AK, G3, Five..." value={weapon.name} />
              <input className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm" disabled={!canManage} min="0" onChange={(event) => patchWeapon(index, { unitPriceInCents: Math.round(Number(event.target.value || 0) * 100) })} placeholder="Valor" type="number" value={weapon.unitPriceInCents ? String(weapon.unitPriceInCents / 100) : ""} />
              <label className="flex items-center gap-2 text-sm text-zinc-300"><input checked={weapon.active !== false} disabled={!canManage} onChange={(event) => patchWeapon(index, { active: event.target.checked })} type="checkbox" /> Ativa</label>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle className="text-base">Vendas recentes</CardTitle></CardHeader><CardContent className="space-y-2">{dashboard.sessions.slice(0, 20).map((session) => <div className="rounded-md border border-zinc-800 bg-black/30 p-3 text-sm text-zinc-300" key={session.id}>{session.saleCode} • {session.buyerFactionName} • {session.status} • {money(session.totalValueInCents)}</div>)}</CardContent></Card>
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 truncate text-lg font-semibold text-zinc-100">{value}</p></CardContent></Card>;
}
function money(cents: number) { return (Math.max(0, cents) / 100).toLocaleString("pt-BR", { currency: "BRL", style: "currency" }); }
