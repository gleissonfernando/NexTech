import { ArrowDown, ArrowUp, Plus, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
    createPriceTable,
    deletePriceTableApi,
    getGuildLiveOptions,
    getPriceTablesDashboard,
    publishPriceTable,
    updatePriceTable
} from "../../lib/api";
import type { DashboardGuild, GuildCategoryOption, GuildChannelOption, PriceTable, PriceTableItem, PriceTableRequest, SavePriceTablePayload } from "../../types";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type Props = {
  botId: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

const emptyItem = (order: number): PriceTableItem => ({
  active: true,
  billingText: null,
  billingType: "one_time",
  description: "",
  highlight: false,
  id: crypto.randomUUID(),
  name: "Novo item",
  order,
  price: 0,
  priceText: null
});

type PriceTablePreset = {
  description: string;
  included: string[];
  name: string;
  systems: string[];
  title: string;
};

const PRICE_TABLE_PRESETS: PriceTablePreset[] = [
  {
    description: "Sistema completo para facções e organizações FiveM, com recursos para controle operacional, membros, pedidos, metas e registros internos.",
    included: ["Facções e famílias", "Ausências FAC", "Ações FAC", "hierarquia", "Encomendas", "Lavagem", "Drogas", "Munição", "Financeiro", "Metas", "CAPTCHA FiveM", "Pedido de Set"],
    name: "Sistema de Facções",
    systems: ["Controle de membros, cargos e operação das facções.", "Ausências com aprovação e logs.", "Ações com participantes, relatórios e histórico.", "Pedidos, entregas, lavagem, drogas, munição e financeiro.", "Metas por membro com registro e acompanhamento."],
    title: "TABELA DE PREÇOS FACÇÕES - NexTech"
  },
  {
    description: "Sistema policial completo para servidores RP, centralizando operação, RH, QRU, promoções, relatórios e automações administrativas.",
    included: ["Ausência Policial", "Ações Policiais", "Corregedoria", "Intimações", "Relatórios Policiais", "QRU", "Promoções de Patente", "Abandono de Veículo", "Canal Oculto", "Mensagem Visível", "Avisos Administrativos", "Ponto/Relógio", "Escala DAF", "Cursos Policiais", "Departamento de RH"],
    name: "Sistema de Polícia",
    systems: ["Fluxo completo para corporações policiais.", "Avaliação, aprovação e histórico de promoções.", "QRUs com evidências, oficiais envolvidos e ranking.", "Relatórios, ponto, escala, RH e cursos.", "Denúncias, intimações, canal oculto e mensagens oficiais."],
    title: "TABELA DE PREÇOS POLÍCIA - NexTech"
  },
  {
    description: "Sistema de vendas para divulgar serviços, planos, pagamentos e atendimento comercial de forma organizada pelo Discord.",
    included: ["Painel de Vendas", "Tabela de Preços", "Pagamentos Manuais", "Pagamento Automático", "Planos", "Cupons", "Histórico Financeiro", "Tickets de Venda"],
    name: "Sistema de Vendas",
    systems: ["Cards e tabelas editáveis pela Dashboard.", "Planos, valores, recorrência e descrição dos serviços.", "Pagamentos manuais e automáticos.", "Histórico e logs financeiros.", "Atendimento comercial integrado ao Discord."],
    title: "TABELA DE PREÇOS VENDAS - NexTech"
  },
  {
    description: "Sistema de segurança para proteger o servidor, controlar riscos, automatizar verificações e registrar ações importantes.",
    included: ["Moderação", "SelfBot Protection", "Segurança por idade de conta", "Anti Abuse", "Anti Ban", "Servidores Suspeitos", "Blacklist Global", "Permissões Avançadas", "Limpeza de Convites", "URL Personalizada", "Anti Disconnect", "Verificação de Tag", "URL na Bio"],
    name: "Sistema de Segurança",
    systems: ["Proteção contra selfbot, abuso e riscos de raid.", "Controle de permissões e ações administrativas.", "Verificações automáticas por tag, bio e idade da conta.", "Blacklist global e servidores suspeitos.", "Logs e alertas para equipe responsável."],
    title: "TABELA DE PREÇOS SEGURANÇA - NexTech"
  }
];

export function PriceTablesPanel({ botId, canManage, guild }: Props) {
  const [tables, setTables] = useState<PriceTable[]>([]);
  const [requests, setRequests] = useState<PriceTableRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SavePriceTablePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [options, setOptions] = useState<{ categories: GuildCategoryOption[]; channels: GuildChannelOption[] }>({ categories: [], channels: [] });
  const selected = useMemo(() => tables.find((table) => table.id === selectedId) ?? null, [selectedId, tables]);
  const preview = { ...selected, ...draft } as PriceTable | null;

  useEffect(() => {
    if (!botId || !guild) return;
    setLoading(true);
    Promise.all([
      getPriceTablesDashboard(botId, guild.id),
      getGuildLiveOptions(guild.id, botId).catch(() => ({ categories: [], channels: [], roles: [] }))
    ])
      .then(([data, guildOptions]) => {
        setTables(data.tables);
        setRequests(data.requests);
        setOptions({ categories: guildOptions.categories ?? [], channels: guildOptions.channels ?? [] });
        const first = data.tables[0] ?? null;
        setSelectedId(first?.id ?? null);
        setDraft(first ? toPayload(first) : null);
      })
      .catch((error) => setMessage(readError(error, "Não foi possível carregar as tabelas.")))
      .finally(() => setLoading(false));
  }, [botId, guild]);

  function selectTable(table: PriceTable) {
    setSelectedId(table.id);
    setDraft(toPayload(table));
    setMessage(null);
  }

  async function createNewTable() {
    if (!botId || !guild) return;
    setSaving(true);
    try {
      const table = await createPriceTable(botId, guild.id, {});
      setTables((current) => [table, ...current]);
      selectTable(table);
      setMessage("Tabela criada.");
    } catch (error) {
      setMessage(readError(error, "Não foi possível criar a tabela."));
    } finally {
      setSaving(false);
    }
  }

  async function createPresetTables(presets: PriceTablePreset[]) {
    if (!botId || !guild) return;
    setSaving(true);
    try {
      const existingNames = new Set(tables.map((table) => table.name.trim().toLowerCase()));
      const created: PriceTable[] = [];
      for (const preset of presets) {
        if (existingNames.has(preset.name.toLowerCase())) continue;
        const table = await createPriceTable(botId, guild.id, presetPayload(preset));
        created.push(table);
        existingNames.add(preset.name.toLowerCase());
      }

      if (created.length) {
        setTables((current) => [...created, ...current]);
        selectTable(created[0]!);
        setMessage(`${created.length} tabela(s) criada(s) com valor mensal padrão de R$ 30,00.`);
      } else {
        setMessage("Essas tabelas já existem.");
      }
    } catch (error) {
      setMessage(readError(error, "Não foi possível criar as tabelas prontas."));
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    if (!botId || !guild || !draft) return;
    setSaving(true);
    try {
      const table = selectedId
        ? await updatePriceTable(botId, guild.id, selectedId, draft)
        : await createPriceTable(botId, guild.id, draft);
      setTables((current) => [table, ...current.filter((item) => item.id !== table.id)]);
      setSelectedId(table.id);
      setDraft(toPayload(table));
      setMessage("Tabela salva.");
    } catch (error) {
      setMessage(readError(error, "Não foi possível salvar a tabela."));
    } finally {
      setSaving(false);
    }
  }

  async function removeSelected() {
    if (!botId || !guild || !selectedId) return;
    setSaving(true);
    try {
      await deletePriceTableApi(botId, guild.id, selectedId);
      const next = tables.filter((table) => table.id !== selectedId);
      setTables(next);
      setSelectedId(next[0]?.id ?? null);
      setDraft(next[0] ? toPayload(next[0]) : null);
      setMessage("Tabela excluida.");
    } catch (error) {
      setMessage(readError(error, "Não foi possível excluir a tabela."));
    } finally {
      setSaving(false);
    }
  }

  async function publishSelected() {
    if (!botId || !guild || !selectedId) return;
    setSaving(true);
    try {
      await saveDraft();
      await publishPriceTable(botId, guild.id, selectedId);
      setMessage("Publicação enviada ao bot.");
    } catch (error) {
      setMessage(readError(error, "Não foi possível publicar a tabela."));
    } finally {
      setSaving(false);
    }
  }

  function patch(patchValue: SavePriceTablePayload) {
    setDraft((current) => ({ ...(current ?? {}), ...patchValue }));
  }

  function patchItem(itemId: string, patchValue: Partial<PriceTableItem>) {
    const items = [...(draft?.items ?? [])].map((item) => item.id === itemId ? { ...item, ...patchValue } : item);
    patch({ items });
  }

  function moveItem(itemId: string, direction: -1 | 1) {
    const items = [...(draft?.items ?? [])].sort((a, b) => a.order - b.order);
    const index = items.findIndex((item) => item.id === itemId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const current = items[index];
    const next = items[target];
    if (!current || !next) return;
    items[index] = next;
    items[target] = current;
    patch({ items: items.map((item, order) => ({ ...item, order })) });
  }

  if (!botId || !guild) {
    return <Card><CardContent className="p-6 text-sm text-zinc-500">Selecione um bot e servidor para gerenciar a tabela de preços.</CardContent></Card>;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Paineis de Vendas</CardTitle>
          <CardDescription>{loading ? "Carregando..." : `${tables.length} tabela(s) cadastrada(s)`}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full" disabled={!canManage || saving} onClick={() => void createNewTable()} type="button"><Plus className="mr-2 h-4 w-4" />Criar produto</Button>
          <Button className="w-full" disabled={!canManage || saving} onClick={() => void createPresetTables(PRICE_TABLE_PRESETS)} type="button" variant="secondary"><Plus className="mr-2 h-4 w-4" />Criar todos prontos</Button>
          <div className="grid gap-2">
            {PRICE_TABLE_PRESETS.map((preset) => (
              <Button className="w-full justify-start" disabled={!canManage || saving} key={preset.name} onClick={() => void createPresetTables([preset])} size="sm" type="button" variant="outline">
                <Plus className="mr-2 h-4 w-4" />{preset.name}
              </Button>
            ))}
          </div>
          {tables.map((table) => (
            <button className={`w-full rounded-lg border p-3 text-left text-sm ${selectedId === table.id ? "border-[#FFD500]/50 bg-[#FFD500]/10 text-white" : "border-zinc-800 bg-zinc-950 text-zinc-400"}`} key={table.id} onClick={() => selectTable(table)} type="button">
              <span className="block truncate font-semibold">{table.name}</span>
              <span className="mt-1 block text-xs">{table.isActive ? "Ativa" : "Inativa"} · {table.items.length} item(s)</span>
            </button>
          ))}
          {message ? <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">{message}</p> : null}
        </CardContent>
      </Card>

      {draft && preview ? (
        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
          <Card>
            <CardHeader>
              <CardTitle>Editor do painel de vendas</CardTitle>
              <CardDescription>Painéis informativos por sistema, sem botão de compra. Cada tabela pode ser publicada em um canal diferente.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Nome da tabela" value={draft.name ?? ""} onChange={(value) => patch({ name: value })} disabled={!canManage} />
                <Field label="Titulo principal" value={draft.title ?? ""} onChange={(value) => patch({ title: value })} disabled={!canManage} />
                <ChannelSelect channels={options.channels} disabled={!canManage} label="Canal de publicação" onChange={(value) => patch({ discordChannelId: value })} value={draft.discordChannelId ?? null} />
                <CategorySelect categories={options.categories} disabled={!canManage} label="Categoria de atendimento" onChange={(value) => patch({ supportCategoryId: value })} value={draft.supportCategoryId ?? null} />
                <Field label="Cargos da equipe (IDs separados por virgula)" value={(draft.supportRoleIds ?? []).join(", ")} onChange={(value) => patch({ supportRoleIds: value.split(",").map((id) => id.trim()).filter(Boolean) })} disabled={!canManage} />
                <ChannelSelect channels={options.channels} disabled={!canManage} label="Canal de logs" onChange={(value) => patch({ logChannelId: value })} value={draft.logChannelId ?? null} />
                <Field label="URL do banner" value={draft.imageUrl ?? ""} onChange={(value) => patch({ imageUrl: value || null })} disabled={!canManage} />
                <Field label="Cor destaque" value={draft.color ?? "#FFD500"} onChange={(value) => patch({ color: value })} disabled={!canManage} />
              </div>
              <Textarea label="Descrição" value={draft.description ?? ""} onChange={(value) => patch({ description: value })} disabled={!canManage} />
              <Textarea label="Observações" value={draft.footerText ?? ""} onChange={(value) => patch({ footerText: value })} disabled={!canManage} />
              <Textarea label="Mensagem inicial do ticket ({user} e {product})" value={draft.ticketInitialMessage ?? ""} onChange={(value) => patch({ ticketInitialMessage: value })} disabled={!canManage} />

              <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
                <h3 className="text-sm font-semibold text-white">Emojis do Painel</h3>
                <p className="text-xs text-zinc-500">Cole o emoji do servidor no formato &lt;:nome:ID&gt;. Nenhum ID fica fixo no código.</p>
                <div className="grid gap-3 md:grid-cols-4">
                  {([['products', 'Produtos'], ['systems', 'Sistemas'], ['advantages', 'Vantagens'], ['support', 'Suporte']] as const).map(([key, label]) => <Field key={key} label={label} value={draft.panelEmojis?.[key] ?? ''} onChange={(value) => patch({ panelEmojis: { ...(draft.panelEmojis ?? preview.panelEmojis), [key]: value } })} disabled={!canManage} />)}
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
                <h3 className="text-sm font-semibold text-white">Secoes do painel</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Titulo: sistemas inclusos" value={draft.panelSections?.includedTitle ?? ''} onChange={(value) => patchSection(draft, patch, preview, { includedTitle: value })} disabled={!canManage} />
                  <Field label="Titulo: sistemas" value={draft.panelSections?.systemsTitle ?? ''} onChange={(value) => patchSection(draft, patch, preview, { systemsTitle: value })} disabled={!canManage} />
                  <Field label="Titulo: vantagens" value={draft.panelSections?.advantagesTitle ?? ''} onChange={(value) => patchSection(draft, patch, preview, { advantagesTitle: value })} disabled={!canManage} />
                  <Field label="Titulo: suporte" value={draft.panelSections?.supportTitle ?? ''} onChange={(value) => patchSection(draft, patch, preview, { supportTitle: value })} disabled={!canManage} />
                </div>
                <Textarea label="Sistemas inclusos (um por linha)" value={(draft.panelSections?.includedItems ?? []).join('\n')} onChange={(value) => patchSection(draft, patch, preview, { includedItems: lines(value) })} disabled={!canManage} />
                <Textarea label="Sistemas e subcategorias" value={draft.panelSections?.systemsText ?? ''} onChange={(value) => patchSection(draft, patch, preview, { systemsText: value })} disabled={!canManage} />
                <Textarea label="Vantagens (uma por linha)" value={(draft.panelSections?.advantages ?? []).join('\n')} onChange={(value) => patchSection(draft, patch, preview, { advantages: lines(value) })} disabled={!canManage} />
                <Textarea label="Texto de suporte" value={draft.panelSections?.supportText ?? ''} onChange={(value) => patchSection(draft, patch, preview, { supportText: value })} disabled={!canManage} />
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <Select label="Moeda" value={draft.currency ?? "BRL"} onChange={(value) => patch({ currency: value as PriceTable["currency"] })} options={["BRL", "USD", "EUR", "CUSTOM"]} disabled={!canManage} />
                <Select label="Imagem" value={draft.imagePosition ?? "top"} onChange={(value) => patch({ imagePosition: value as PriceTable["imagePosition"] })} options={["top", "bottom", "thumbnail", "none"]} disabled={!canManage} />
                <Field label="Botão orcamento" value={draft.buttonText?.quote ?? ""} onChange={(value) => patch({ buttonText: { ...(draft.buttonText ?? preview.buttonText), quote: value } })} disabled={!canManage} />
                <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3">
                  <span className="text-sm text-zinc-300">Ativa</span>
                  <Switch checked={draft.isActive ?? true} disabled={!canManage} onCheckedChange={(checked) => patch({ isActive: checked })} />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-white">Itens da tabela</h3>
                  <Button disabled={!canManage} onClick={() => patch({ items: [...(draft.items ?? []), emptyItem(draft.items?.length ?? 0)] })} size="sm" type="button"><Plus className="mr-2 h-4 w-4" />Adicionar</Button>
                </div>
                {(draft.items ?? []).sort((a, b) => a.order - b.order).map((item) => (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3" key={item.id}>
                    <div className="grid gap-3 md:grid-cols-[1fr_120px_140px_auto]">
                      <Field label="Nome" value={item.name} onChange={(value) => patchItem(item.id, { name: value })} disabled={!canManage} />
                      <Field label="Valor" type="number" value={String(item.price)} onChange={(value) => patchItem(item.id, { price: Number(value) })} disabled={!canManage} />
                      <Select label="Cobranca" value={item.billingType} onChange={(value) => patchItem(item.id, { billingType: value as PriceTableItem["billingType"] })} options={["one_time", "monthly", "weekly", "custom"]} disabled={!canManage} />
                      <div className="flex items-end gap-2">
                        <IconButton disabled={!canManage} icon={ArrowUp} onClick={() => moveItem(item.id, -1)} />
                        <IconButton disabled={!canManage} icon={ArrowDown} onClick={() => moveItem(item.id, 1)} />
                        <IconButton disabled={!canManage} icon={Trash2} onClick={() => patch({ items: (draft.items ?? []).filter((current) => current.id !== item.id).map((current, order) => ({ ...current, order })) })} />
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_140px_120px_120px]">
                      <Field label="Descrição curta" value={item.description ?? ""} onChange={(value) => patchItem(item.id, { description: value })} disabled={!canManage} />
                      <Field label="Texto valor" value={item.priceText ?? ""} onChange={(value) => patchItem(item.id, { priceText: value || null })} disabled={!canManage} />
                      <Toggle label="Destaque" checked={item.highlight} disabled={!canManage} onChange={(checked) => patchItem(item.id, { highlight: checked })} />
                      <Toggle label="Ativo" checked={item.active} disabled={!canManage} onChange={(checked) => patchItem(item.id, { active: checked })} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-3">
                <Button disabled={!canManage || saving} onClick={() => void saveDraft()} type="button"><Save className="mr-2 h-4 w-4" />Salvar</Button>
                <Button disabled={!canManage || saving || !selectedId} onClick={() => void publishSelected()} type="button" variant="secondary"><Send className="mr-2 h-4 w-4" />Publicar no Discord</Button>
                <Button disabled={!canManage || saving || !selectedId} onClick={() => void removeSelected()} type="button" variant="destructive"><Trash2 className="mr-2 h-4 w-4" />Excluir</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pre-visualizacao</CardTitle>
              <CardDescription>{preview.discordChannelId ? `Canal ${preview.discordChannelId}` : "Canal não configurado"}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border border-zinc-800 bg-[#31323a]">
                {preview.imageUrl && preview.imagePosition !== "none" ? <img alt="" className="h-36 w-full object-cover" src={preview.imageUrl} /> : null}
                <div className="space-y-4 border-l-4 border-[#9B35FF] p-4">
                  <div className="border-b border-white/10 pb-3">
                    <h3 className="text-lg font-extrabold text-white">{displayEmoji(preview.panelEmojis.products, "💜")} {preview.title}</h3>
                    <p className="mt-3 whitespace-pre-line text-sm font-semibold leading-relaxed text-white">{preview.description}</p>
                  </div>
                  <PreviewSection icon={displayEmoji(preview.panelEmojis.products, "💜")} title={preview.panelSections.includedTitle} lines={preview.panelSections.includedItems.map((item) => `- ${item}`)} />
                  <PreviewSection icon={displayEmoji(preview.panelEmojis.systems, "🛡️")} title={preview.panelSections.systemsTitle} lines={preview.panelSections.systemsText.split(/\r?\n/)} />
                  <div className="space-y-2">
                    <p className="text-sm font-extrabold text-white">{displayEmoji(preview.panelEmojis.products, "💜")} Planos</p>
                    {preview.items.filter((item) => item.active).sort((a, b) => a.order - b.order).map((item) => (
                      <div className={`border-l-4 py-1 pl-3 text-sm font-bold ${item.highlight ? "border-[#9B35FF] text-white" : "border-white/20 text-zinc-200"}`} key={item.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p>- {item.name} — {formatPrice(preview, item)}{billingSuffixPreview(item)}</p>
                            {item.description ? <p className="mt-1 text-xs text-zinc-300">{item.description}</p> : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <PreviewSection icon={displayEmoji(preview.panelEmojis.advantages, "💎")} title={preview.panelSections.advantagesTitle} lines={preview.panelSections.advantages.map((item) => `- ${item}`)} />
                  <PreviewSection icon={displayEmoji(preview.panelEmojis.support, "🌀")} title={preview.panelSections.supportTitle} lines={preview.panelSections.supportText.split(/\r?\n/)} />
                  {preview.footerText ? <p className="border-t border-white/10 pt-3 text-xs font-bold italic text-white">{displayEmoji(preview.panelEmojis.support, "🌀")} {preview.footerText}</p> : null}
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <h3 className="text-sm font-semibold text-white">Solicitacoes recentes</h3>
                {requests.slice(0, 5).map((request) => <p className="rounded-lg bg-zinc-950 p-3 text-xs text-zinc-400" key={request.id}>{request.userName} pediu {request.itemName}</p>)}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card><CardContent className="p-6 text-sm text-zinc-500">Crie uma tabela para comecar.</CardContent></Card>
      )}
    </div>
  );
}

function Field({ disabled, label, onChange, type = "text", value }: { disabled?: boolean; label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return <label className="block text-xs font-medium text-zinc-500">{label}<input className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]/50" disabled={disabled} onChange={(event) => onChange(event.target.value)} type={type} value={value} /></label>;
}

function Textarea({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="block text-xs font-medium text-zinc-500">{label}<textarea className="mt-1 min-h-24 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-[#FFD500]/50" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} /></label>;
}

function ChannelSelect({ channels, disabled, label, onChange, value }: { channels: GuildChannelOption[]; disabled?: boolean; label: string; onChange: (value: string | null) => void; value: string | null }) {
  return (
    <label className="block text-xs font-medium text-zinc-500">
      {label}
      <select className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]/50" disabled={disabled} onChange={(event) => onChange(event.target.value || null)} value={value ?? ""}>
        <option value="">Selecionar canal</option>
        {channels.map((channel) => <option key={channel.id} value={channel.id}># {channel.name}</option>)}
      </select>
    </label>
  );
}

function CategorySelect({ categories, disabled, label, onChange, value }: { categories: GuildCategoryOption[]; disabled?: boolean; label: string; onChange: (value: string | null) => void; value: string | null }) {
  return (
    <label className="block text-xs font-medium text-zinc-500">
      {label}
      <select className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]/50" disabled={disabled} onChange={(event) => onChange(event.target.value || null)} value={value ?? ""}>
        <option value="">Selecionar categoria</option>
        {categories.map((category) => <option key={category.id} value={category.id}>📁 {category.name}</option>)}
      </select>
    </label>
  );
}

function Select({ disabled, label, onChange, options, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  return <label className="block text-xs font-medium text-zinc-500">{label}<select className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]/50" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <div className="flex h-10 items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3"><span className="text-xs text-zinc-400">{label}</span><Switch checked={checked} disabled={disabled} onCheckedChange={onChange} /></div>;
}

function IconButton({ disabled, icon: Icon, onClick }: { disabled?: boolean; icon: typeof ArrowUp; onClick: () => void }) {
  return <button className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 transition hover:border-[#FFD500]/40 hover:text-white disabled:opacity-50" disabled={disabled} onClick={onClick} type="button"><Icon className="h-4 w-4" /></button>;
}

function PreviewSection({ icon, lines, title }: { icon: string; lines: string[]; title: string }) {
  const visibleLines = lines.map((line) => line.trim()).filter(Boolean);
  return (
    <div className="space-y-2">
      <p className="text-sm font-extrabold text-white">{icon} {title}</p>
      <div className="border-l-4 border-[#9B35FF] py-1 pl-3 text-sm font-bold leading-relaxed text-zinc-200">
        {(visibleLines.length ? visibleLines : ["- Consulte nossa equipe"]).map((line, index) => <p key={`${title}-${index}`}>{line}</p>)}
      </div>
    </div>
  );
}

function lines(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function displayEmoji(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  if (/^<a?:[^:]+:\d+>$/.test(normalized)) return fallback;
  return normalized;
}

function presetPayload(preset: PriceTablePreset): SavePriceTablePayload {
  return {
    buttonText: {
      plans: "Ver Planos",
      quote: "Solicitar Orçamento",
      support: "Abrir Ticket"
    },
    color: "#9B35FF",
    currency: "BRL",
    currencyFormat: "R$",
    description: [
      `**${preset.name}** para servidores RP e comunidades Discord.`,
      "Inclui configuração pela Dashboard, publicação em canal próprio e suporte para deixar o módulo pronto para uso."
    ].join("\n"),
    discordChannelId: null,
    footerText: "Para orçamentos personalizados, dúvidas ou demonstrações, basta abrir um ticket e nossa equipe irá atender rapidinho.",
    imagePosition: "none",
    imageUrl: null,
    isActive: true,
    items: [
      {
        active: true,
        billingText: "mês",
        billingType: "monthly",
        description: preset.description,
        highlight: true,
        id: crypto.randomUUID(),
        name: preset.name,
        order: 0,
        price: 30,
        priceText: "R$ 30,00"
      }
    ],
    name: preset.name,
    panelEmojis: {
      advantages: "💎",
      products: "💜",
      support: "🌀",
      systems: "🛡️"
    },
    panelSections: {
      advantages: [
        "Configuração completa pela Dashboard.",
        "Publicação em canal individual.",
        "Atualização automática ao salvar alterações.",
        "Suporte para implantação e ajustes."
      ],
      advantagesTitle: "Melhorias",
      includedItems: [
        ...preset.included,
        "Painel em Componentes V2",
        "Configuração editável",
        "Suporte mensal"
      ],
      includedTitle: "Incluso",
      supportText: "Abra um ticket para contratar, tirar dúvidas ou solicitar personalizações.",
      supportTitle: "Atendimento",
      systemsText: preset.systems.map((item) => `- ${item}`).join("\n"),
      systemsTitle: "Sistema"
    },
    title: preset.title
  };
}

function patchSection(
  draft: SavePriceTablePayload,
  patch: (value: SavePriceTablePayload) => void,
  preview: PriceTable,
  value: Partial<PriceTable["panelSections"]>
) {
  patch({ panelSections: { ...(draft.panelSections ?? preview.panelSections), ...value } });
}

function toPayload(table: PriceTable): SavePriceTablePayload {
  const { botId: _botId, createdAt: _createdAt, createdBy: _createdBy, guildId: _guildId, id: _id, messageId: _messageId, updatedAt: _updatedAt, updatedBy: _updatedBy, ...payload } = table;
  return payload;
}

function formatPrice(table: PriceTable, item: PriceTableItem) {
  if (item.priceText) return item.priceText;
  if (table.currency === "BRL") return new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" }).format(item.price);
  if (table.currency === "USD") return new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" }).format(item.price);
  if (table.currency === "EUR") return new Intl.NumberFormat("de-DE", { currency: "EUR", style: "currency" }).format(item.price);
  return `${table.currencyFormat}${item.price.toFixed(2)}`;
}

function billingSuffixPreview(item: PriceTableItem) {
  if (item.billingText) return ` / ${item.billingText}`;
  return ({ custom: "", monthly: " / mensal", one_time: " / unico", weekly: " / semanal" } as const)[item.billingType];
}

function readError(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
