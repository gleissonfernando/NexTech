import { Plus, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getGuildLiveOptions, getGuildMemberOptions, getPd7Dashboard, listPd7Factions, publishPd7Panel, savePd7Settings } from "../../lib/api";
import { type DashboardGuild, type GuildLiveOptions, type GuildMemberOption, type Pd7Dashboard, type Pd7Field, type Pd7Settings } from "../../types";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import { FivemResourceMultiSelect, FivemResourceSelect } from "./FivemResourceSelect";

const empty = (guildId: string, botId: string, id: string): Pd7Settings => ({
  _id: "",
  botId,
  guildId,
  factionId: id,
  factionName: "Nova facção",
  enabled: false,
  categoryPD7: null,
  panelChannelPD7: null,
  logChannelPD7: null,
  allowedRolesPD7: [],
  responsibleUsersPD7: [],
  approvedRolePD7: null,
  rejectedRolePD7: null,
  fields: [{ id: "ingame_name", label: "Nome In-game", placeholder: "Informe seu nome", required: true, style: "short", order: 0 }],
  autoDeleteMinutes: 60,
  panelMessageId: null,
  publishRequestedAt: null,
  createdAt: "",
  updatedAt: ""
});

export function Pd7Panel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [items, setItems] = useState<Pd7Settings[]>([]);
  const [draft, setDraft] = useState<Pd7Settings | null>(null);
  const [data, setData] = useState<Pd7Dashboard | null>(null);
  const [options, setOptions] = useState<GuildLiveOptions>({ channels: [], roles: [] });
  const [members, setMembers] = useState<GuildMemberOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!guild || !botId) return;

    setBusy(true);
    Promise.all([
      listPd7Factions(guild.id, botId),
      getGuildLiveOptions(guild.id, botId),
      getGuildMemberOptions(guild.id, "", botId)
    ])
      .then(([rows, opt, mem]) => {
        setItems(rows);
        setOptions(opt);
        setMembers(mem);
        if (rows[0]) void select(rows[0]);
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "Falha ao carregar Pedir Set"))
      .finally(() => setBusy(false));
  }, [guild?.id, botId]);

  async function select(row: Pd7Settings) {
    setDraft(row);
    if (guild && botId) setData(await getPd7Dashboard(guild.id, row.factionId, botId));
  }

  function patch(value: Partial<Pd7Settings>) {
    setDraft((current) => current ? { ...current, ...value } : current);
  }

  function patchField(index: number, value: Partial<Pd7Field>) {
    if (!draft) return;
    patch({ fields: draft.fields.map((field, currentIndex) => currentIndex === index ? { ...field, ...value } : field) });
  }

  async function save() {
    if (!guild || !botId || !draft) return;
    setBusy(true);
    try {
      const saved = await savePd7Settings(guild.id, draft.factionId, botId, draft);
      setDraft(saved);
      setItems((current) => [...current.filter((item) => item.factionId !== saved.factionId), saved]);
      setNotice("Configuração salva.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!guild || !botId || !draft) return;
    setBusy(true);
    try {
      await save();
      await publishPd7Panel(guild.id, draft.factionId, botId);
      setNotice("Publicação solicitada ao bot.");
    } finally {
      setBusy(false);
    }
  }

  if (!guild || !botId) return <Card><CardContent className="p-6 text-zinc-500">Selecione um servidor e um bot.</CardContent></Card>;

  const roles = options.roles.map((role) => ({ id: role.id, name: role.name, color: role.color, disabled: !role.assignable }));
  const channels = options.channels.map((channel) => ({ id: channel.id, name: channel.name }));
  const categories = (options.categories ?? []).map((category) => ({ id: category.id, name: category.name }));
  const users = members.filter((member) => !member.bot).map((member) => ({ id: member.id, name: member.displayName }));

  return <div className="space-y-4"><Card>
    <CardHeader>
      <CardTitle>Facções • Pedir Set</CardTitle>
      <CardDescription>Configurações independentes por facção, formulário dinâmico e operação em Componentes V2.</CardDescription>
    </CardHeader>
    <CardContent className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-2">
        <Button disabled={!canManage} onClick={() => { const id = crypto.randomUUID().slice(0, 8); setDraft(empty(guild.id, botId, id)); setData(null); }}><Plus className="mr-2 h-4 w-4" />Nova facção</Button>
        {items.map((item) => <button className={`w-full rounded border p-3 text-left ${draft?.factionId === item.factionId ? "border-emerald-500 bg-emerald-500/10" : "border-zinc-800"}`} key={item.factionId} onClick={() => void select(item)}>
          <p className="font-medium text-white">{item.factionName}</p>
          <span className="text-xs text-zinc-500">{item.enabled ? "Pedir Set ativo" : "Pedir Set inativo"}</span>
        </button>)}
      </aside>
      {draft ? <main className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <input className="h-10 rounded border border-zinc-800 bg-black px-3 text-white" disabled={!canManage} value={draft.factionName} onChange={(event) => patch({ factionName: event.target.value })} />
          <div className="flex gap-2">
            <Button disabled={!canManage || busy} onClick={() => void save()}><Save className="mr-2 h-4 w-4" />Salvar</Button>
            <Button disabled={!canManage || busy || !draft.panelChannelPD7} onClick={() => void publish()}><Send className="mr-2 h-4 w-4" />Publicar painel</Button>
          </div>
        </div>
        {notice ? <p className="text-sm text-emerald-300">{notice}</p> : null}
        <label className="flex items-center justify-between rounded border border-zinc-800 p-3 text-sm text-white">Sistema Pedir Set ativo<Switch checked={draft.enabled} disabled={!canManage} onCheckedChange={(enabled) => patch({ enabled })} /></label>
        <section className="grid gap-4 md:grid-cols-2">
          <FivemResourceSelect disabled={!canManage} label="Categoria dos canais" options={categories} value={draft.categoryPD7} onChange={(value) => patch({ categoryPD7: value })} />
          <FivemResourceSelect disabled={!canManage} label="Canal do painel" options={channels} value={draft.panelChannelPD7} onChange={(value) => patch({ panelChannelPD7: value })} />
          <FivemResourceSelect disabled={!canManage} label="Canal de logs" options={channels} value={draft.logChannelPD7} onChange={(value) => patch({ logChannelPD7: value })} />
          <FivemResourceSelect disabled={!canManage} label="Cargo aprovado" options={roles} value={draft.approvedRolePD7} onChange={(value) => patch({ approvedRolePD7: value })} />
          <FivemResourceSelect disabled={!canManage} label="Cargo reprovado (não aplicado automaticamente)" options={roles} value={draft.rejectedRolePD7} onChange={(value) => patch({ rejectedRolePD7: value })} />
          <label className="grid gap-2 text-xs text-zinc-400">Excluir canal após (minutos, 0 arquiva)<input className="h-11 rounded border border-zinc-800 bg-black px-3 text-white" type="number" value={draft.autoDeleteMinutes ?? 0} onChange={(event) => patch({ autoDeleteMinutes: Number(event.target.value) })} /></label>
        </section>
        <FivemResourceMultiSelect disabled={!canManage} label="Cargos responsáveis" options={roles} values={draft.allowedRolesPD7} onChange={(value) => patch({ allowedRolesPD7: value })} />
        <FivemResourceMultiSelect disabled={!canManage} label="Usuários responsáveis" options={users} values={draft.responsibleUsersPD7} onChange={(value) => patch({ responsibleUsersPD7: value })} />
        <section className="space-y-3 border-t border-zinc-800 pt-4">
          <div className="flex justify-between">
            <div><h3 className="font-semibold text-white">Campos do Modal V2</h3><p className="text-xs text-zinc-500">Até 5 campos, conforme limite do Discord.</p></div>
            <Button disabled={!canManage || draft.fields.length >= 5} onClick={() => patch({ fields: [...draft.fields, { id: `field_${Date.now()}`, label: "Novo campo", placeholder: null, required: false, style: "short", order: draft.fields.length }] })}><Plus className="mr-2 h-4 w-4" />Campo</Button>
          </div>
          {draft.fields.map((field, index) => <div className="grid gap-2 rounded border border-zinc-800 p-3 md:grid-cols-[1fr_1fr_140px_100px_40px]" key={field.id}>
            <input className="rounded bg-black px-3 py-2 text-sm text-white" value={field.label} onChange={(event) => patchField(index, { label: event.target.value })} />
            <input className="rounded bg-black px-3 py-2 text-sm text-white" placeholder="Texto de ajuda" value={field.placeholder ?? ""} onChange={(event) => patchField(index, { placeholder: event.target.value || null })} />
            <select className="rounded bg-black px-2 text-sm text-white" value={field.style} onChange={(event) => patchField(index, { style: event.target.value as Pd7Field["style"] })}><option value="short">Texto curto</option><option value="paragraph">Parágrafo</option></select>
            <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={field.required} onChange={(event) => patchField(index, { required: event.target.checked })} />Obrigatório</label>
            <Button size="icon" variant="destructive" disabled={draft.fields.length <= 1} onClick={() => patch({ fields: draft.fields.filter((_, currentIndex) => currentIndex !== index).map((item, order) => ({ ...item, order })) })}><Trash2 className="h-4 w-4" /></Button>
          </div>)}
        </section>
        {data ? <section className="grid gap-3 border-t border-zinc-800 pt-4 sm:grid-cols-5">
          {[["Total", data.stats.total], ["Pendentes", data.stats.pending], ["Aprovados", data.stats.approved], ["Reprovados", data.stats.rejected], ["Tempo médio", `${data.stats.averageAnalysisMinutes} min`]].map(([label, value]) => <div className="rounded border border-zinc-800 p-3" key={label}><p className="text-xs text-zinc-500">{label}</p><p className="text-xl font-semibold text-white">{value}</p></div>)}
        </section> : null}
      </main> : <p className="text-zinc-500">Crie ou selecione uma facção.</p>}
    </CardContent>
  </Card></div>;
}
