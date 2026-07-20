import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, ClipboardList, Copy, Loader2, Plus, Save, Send, ShieldCheck, Trash2 } from "lucide-react";
import { getGuildLiveOptions, getPolicePromotionDashboard, publishPolicePromotionPanel, savePolicePromotionSettings } from "../../lib/api";
import type {
  DashboardGuild,
  GuildCategoryOption,
  GuildChannelOption,
  GuildRoleOption,
  PolicePromotionDashboard,
  PolicePromotionDefinition,
  PolicePromotionQuestion,
  PolicePromotionQuestionType,
  PolicePromotionSettings
} from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import { FivemResourceMultiSelect, FivemResourceSelect } from "../fivem/FivemResourceSelect";

const QUESTION_TYPES: Array<{ id: PolicePromotionQuestionType; name: string }> = [
  { id: "short", name: "Texto curto" },
  { id: "paragraph", name: "Parágrafo" },
  { id: "number", name: "Número" },
  { id: "date", name: "Data" },
  { id: "time", name: "Horário" },
  { id: "select", name: "Seleção" },
  { id: "checkbox", name: "Múltipla escolha" },
  { id: "radio", name: "Escolha única" }
];

export function PolicePromotionsPanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [data, setData] = useState<PolicePromotionDashboard | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [categories, setCategories] = useState<GuildCategoryOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const settingsRef = useRef<PolicePromotionSettings | null>(null);

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
        getPolicePromotionDashboard(guild.id, botId),
        getGuildLiveOptions(guild.id, botId)
      ]);
      setData(dashboard);
      settingsRef.current = dashboard.settings;
      setSelectedId((current) => current ?? dashboard.settings.promotions[0]?.id ?? null);
      setChannels(options.channels ?? []);
      setCategories(options.categories ?? []);
      setRoles(options.roles ?? []);
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setLoading(false);
    }
  }, [botId, guild]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(() => data?.settings.promotions.find((item) => item.id === selectedId) ?? data?.settings.promotions[0] ?? null, [data?.settings.promotions, selectedId]);
  const disabled = !canManage || saving;
  const roleOptions = useMemo(() => roles.map((role) => ({ color: role.color, disabled: role.managed, id: role.id, name: role.name })), [roles]);
  const channelOptions = useMemo(() => channels.map((channel) => ({ id: channel.id, name: channel.name })), [channels]);
  const categoryOptions = useMemo(() => categories.map((category) => ({ id: category.id, name: category.name })), [categories]);

  if (!botId || !guild) return <Empty text="Selecione um bot e servidor para configurar promoções." />;
  if (loading || !data) return <Empty loading text="Carregando promoções..." />;

  function patchSettings(next: Partial<PolicePromotionSettings>) {
    const settings = { ...(settingsRef.current ?? data!.settings), ...next };
    settingsRef.current = settings;
    setData((current) => current ? { ...current, settings } : current);
  }

  function patchPromotion(id: string, next: Partial<PolicePromotionDefinition>) {
    const settings = settingsRef.current ?? data!.settings;
    patchSettings({ promotions: settings.promotions.map((promotion) => promotion.id === id ? { ...promotion, ...next } : promotion) });
  }

  function patchQuestion(promotionId: string, questionId: string, next: Partial<PolicePromotionQuestion>) {
    const promotion = (settingsRef.current ?? data!.settings).promotions.find((item) => item.id === promotionId);
    if (!promotion) return;
    patchPromotion(promotionId, { questions: promotion.questions.map((question) => question.id === questionId ? { ...question, ...next } : question) });
  }

  async function save() {
    if (!canManage || !guild || !botId || !settingsRef.current) return;
    setSaving(true);
    setMessage(null);
    try {
      const settings = await savePolicePromotionSettings(guild.id, botId, settingsRef.current);
      settingsRef.current = settings;
      setData((current) => current ? { ...current, settings } : current);
      setMessage("Configurações de promoções salvas.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function publishPanel() {
    if (!canManage || !guild || !botId || !settingsRef.current) return;
    setPublishing(true);
    setSaving(true);
    setMessage(null);
    try {
      const saved = await savePolicePromotionSettings(guild.id, botId, settingsRef.current);
      settingsRef.current = saved;
      setData((current) => current ? { ...current, settings: saved } : current);
      const published = await publishPolicePromotionPanel(guild.id, botId);
      settingsRef.current = published;
      setData((current) => current ? { ...current, settings: published } : current);
      setMessage("Publicação do painel enviada para o bot.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setPublishing(false);
      setSaving(false);
    }
  }

  function addPromotion() {
    const promotion = newPromotion();
    patchSettings({ promotions: [...data!.settings.promotions, promotion] });
    setSelectedId(promotion.id);
  }

  function duplicatePromotion(promotion: PolicePromotionDefinition) {
    const copyPromotion = { ...promotion, id: crypto.randomUUID(), name: `${promotion.name} (cópia)`, panelMessageId: null, questions: promotion.questions.map((question, order) => ({ ...question, id: crypto.randomUUID(), order })) };
    patchSettings({ promotions: [...data!.settings.promotions, copyPromotion] });
    setSelectedId(copyPromotion.id);
  }

  function removePromotion(id: string) {
    const next = data!.settings.promotions.filter((promotion) => promotion.id !== id);
    patchSettings({ promotions: next });
    setSelectedId(next[0]?.id ?? null);
  }

  function addQuestion(promotion: PolicePromotionDefinition) {
    patchPromotion(promotion.id, { questions: [...promotion.questions, newQuestion(promotion.questions.length)] });
  }

  function removeQuestion(promotion: PolicePromotionDefinition, questionId: string) {
    patchPromotion(promotion.id, { questions: promotion.questions.filter((question) => question.id !== questionId).map((question, order) => ({ ...question, order })) });
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-blue-300" />Promoções de Patente</CardTitle>
              <CardDescription>Solicitações, avaliação por instrutor, fila de aprovação, cargos automáticos e histórico.</CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={data.settings.enabled ? "success" : "muted"}>{data.settings.enabled ? "Ativo" : "Desativado"}</Badge>
              <Button disabled={disabled || publishing || !data.settings.enabled || !data.settings.defaultPanelChannelId} onClick={() => void publishPanel()} size="sm" variant="secondary">
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Publicar painel
              </Button>
              <Button disabled={disabled} onClick={() => void save()} size="sm"><Save className="h-4 w-4" />Salvar</Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {message ? <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-white">{message}</div> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Solicitações" value={data.stats.total} />
        <Metric label="Pendentes" value={data.stats.pending} />
        <Metric label="Aprovadas" value={data.stats.approved} />
        <Metric label="Reprovadas" value={data.stats.rejected} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuração Geral</CardTitle>
          <CardDescription>Canais padrão usados quando uma promoção não possuir canal próprio.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <FivemResourceSelect disabled={disabled} label="Canal padrão do painel" options={channelOptions} prefix="#" value={data.settings.defaultPanelChannelId} onChange={(defaultPanelChannelId) => patchSettings({ defaultPanelChannelId })} />
          <FivemResourceSelect disabled={disabled} label="Categoria padrão dos tickets" options={categoryOptions} value={data.settings.defaultCategoryId} onChange={(defaultCategoryId) => patchSettings({ defaultCategoryId })} />
          <FivemResourceSelect disabled={disabled} label="Canal padrão de aprovação" options={channelOptions} prefix="#" value={data.settings.defaultApprovalChannelId} onChange={(defaultApprovalChannelId) => patchSettings({ defaultApprovalChannelId })} />
          <FivemResourceSelect disabled={disabled} label="Canal padrão de histórico" options={channelOptions} prefix="#" value={data.settings.defaultHistoryChannelId} onChange={(defaultHistoryChannelId) => patchSettings({ defaultHistoryChannelId })} />
          <FivemResourceSelect disabled={disabled} label="Canal padrão de logs" options={channelOptions} prefix="#" value={data.settings.defaultLogChannelId} onChange={(defaultLogChannelId) => patchSettings({ defaultLogChannelId })} />
          <Toggle disabled={disabled} label="Sistema de promoções ativo" value={data.settings.enabled} onChange={(enabled) => patchSettings({ enabled })} />
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Promoções</CardTitle>
                <CardDescription>Modelos disponíveis no seletor do Discord.</CardDescription>
              </div>
              <Button disabled={disabled} onClick={addPromotion} size="sm"><Plus className="h-4 w-4" />Nova</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.settings.promotions.map((promotion) => (
              <button className={`w-full rounded-lg border p-3 text-left transition ${selected?.id === promotion.id ? "border-blue-400/70 bg-blue-500/10" : "border-zinc-800 hover:border-zinc-700"}`} key={promotion.id} onClick={() => setSelectedId(promotion.id)} type="button">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-white">{promotion.emoji ?? "📋"} {promotion.name}</span>
                  <Badge variant={promotion.active ? "success" : "muted"}>{promotion.active ? "Ativa" : "Inativa"}</Badge>
                </div>
                <p className="mt-1 truncate text-xs text-zinc-500">{promotion.receivedRankName}</p>
              </button>
            ))}
            {!data.settings.promotions.length ? <p className="py-8 text-center text-sm text-zinc-500">Nenhuma promoção cadastrada.</p> : null}
          </CardContent>
        </Card>

        {selected ? (
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>{selected.name}</CardTitle>
                    <CardDescription>Detalhes do painel, ticket e decisão final.</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button disabled={disabled} onClick={() => duplicatePromotion(selected)} size="sm" variant="ghost"><Copy className="h-4 w-4" />Duplicar</Button>
                    <Button disabled={disabled || data.settings.promotions.length <= 1} onClick={() => removePromotion(selected.id)} size="sm" variant="destructive"><Trash2 className="h-4 w-4" />Excluir</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-2">
                <Field disabled={disabled} label="Nome da promoção" value={selected.name} onChange={(name) => patchPromotion(selected.id, { name })} />
                <Field disabled={disabled} label="Patente recebida" value={selected.receivedRankName} onChange={(receivedRankName) => patchPromotion(selected.id, { receivedRankName })} />
                <Field disabled={disabled} label="Emoji" value={selected.emoji ?? ""} onChange={(emoji) => patchPromotion(selected.id, { emoji: emoji || null })} />
                <Field disabled={disabled} label="Cor" type="color" value={selected.color} onChange={(color) => patchPromotion(selected.id, { color })} />
                <Field disabled={disabled} label="Título do painel" value={selected.panelTitle} onChange={(panelTitle) => patchPromotion(selected.id, { panelTitle })} />
                <Field disabled={disabled} label="Descrição do painel" value={selected.panelDescription} onChange={(panelDescription) => patchPromotion(selected.id, { panelDescription })} />
                <FivemResourceSelect disabled={disabled} label="Canal próprio do painel" options={channelOptions} prefix="#" value={selected.panelChannelId} onChange={(panelChannelId) => patchPromotion(selected.id, { panelChannelId })} />
                <FivemResourceSelect disabled={disabled} label="Categoria própria dos tickets" options={categoryOptions} value={selected.categoryId} onChange={(categoryId) => patchPromotion(selected.id, { categoryId })} />
                <FivemResourceSelect disabled={disabled} label="Canal de histórico" options={channelOptions} prefix="#" value={selected.historyChannelId} onChange={(historyChannelId) => patchPromotion(selected.id, { historyChannelId })} />
                <FivemResourceSelect disabled={disabled} label="Canal de logs" options={channelOptions} prefix="#" value={selected.logChannelId} onChange={(logChannelId) => patchPromotion(selected.id, { logChannelId })} />
                <FivemResourceSelect disabled={disabled} label="Cargo concedido na aprovação" options={roleOptions} prefix="@" value={selected.grantedRoleId} onChange={(grantedRoleId) => patchPromotion(selected.id, { grantedRoleId })} />
                <FivemResourceSelect disabled={disabled} label="Cargo removido na aprovação" options={roleOptions} prefix="@" value={selected.removedRoleId} onChange={(removedRoleId) => patchPromotion(selected.id, { removedRoleId })} />
                <div className="lg:col-span-2"><FivemResourceMultiSelect disabled={disabled} label="Cargos dos instrutores avaliadores" options={roleOptions} prefix="@" values={selected.evaluatorRoleIds} onChange={(evaluatorRoleIds) => patchPromotion(selected.id, { evaluatorRoleIds })} /></div>
                <div className="lg:col-span-2"><FivemResourceMultiSelect disabled={disabled} label="Cargos que aprovam promoções" options={roleOptions} prefix="@" values={selected.approvalRoleIds} onChange={(approvalRoleIds) => patchPromotion(selected.id, { approvalRoleIds })} /></div>
                <div className="lg:col-span-2"><FivemResourceMultiSelect disabled={disabled} label="Cargos que reprovam promoções" options={roleOptions} prefix="@" values={selected.rejectedRoleIds} onChange={(rejectedRoleIds) => patchPromotion(selected.id, { rejectedRoleIds })} /></div>
                <Toggle disabled={disabled} label="Promoção ativa no painel" value={selected.active} onChange={(active) => patchPromotion(selected.id, { active })} />
                <Toggle disabled={disabled} label="Permitir solicitar nova avaliação" value={selected.requestNewEvaluationEnabled} onChange={(requestNewEvaluationEnabled) => patchPromotion(selected.id, { requestNewEvaluationEnabled })} />
                <div className="lg:col-span-2"><TextArea disabled={disabled} label="Descrição completa" value={selected.description} onChange={(description) => patchPromotion(selected.id, { description })} /></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Perguntas Dinâmicas</CardTitle>
                    <CardDescription>Campos exibidos no Discord por modal, seleção ou múltipla escolha.</CardDescription>
                  </div>
                  <Button disabled={disabled} onClick={() => addQuestion(selected)} size="sm"><Plus className="h-4 w-4" />Pergunta</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {[...selected.questions].sort((a, b) => a.order - b.order).map((question, index) => (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4" key={question.id}>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-white"><ClipboardList className="h-4 w-4 text-blue-300" />{index + 1}. {question.label || "Nova pergunta"}</div>
                      <Button disabled={disabled || selected.questions.length <= 1} onClick={() => removeQuestion(selected, question.id)} size="sm" variant="destructive"><Trash2 className="h-4 w-4" />Remover</Button>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      <Field disabled={disabled} label="Título da pergunta" value={question.label} onChange={(label) => patchQuestion(selected.id, question.id, { label })} />
                      <Select disabled={disabled} label="Tipo" options={QUESTION_TYPES} value={question.type} onChange={(type) => patchQuestion(selected.id, question.id, { type: type as PolicePromotionQuestionType })} />
                      <Field disabled={disabled} label="Placeholder" value={question.placeholder ?? ""} onChange={(placeholder) => patchQuestion(selected.id, question.id, { placeholder: placeholder || null })} />
                      <Field disabled={disabled} label="Tamanho máximo" type="number" value={String(question.maxLength ?? "")} onChange={(value) => patchQuestion(selected.id, question.id, { maxLength: value ? Number(value) : null })} />
                      <div className="lg:col-span-2"><TextArea disabled={disabled} label="Descrição/ajuda" value={question.description ?? ""} onChange={(description) => patchQuestion(selected.id, question.id, { description: description || null })} /></div>
                      <div className="lg:col-span-2"><TextArea disabled={disabled || !usesOptions(question.type)} label="Opções (uma por linha)" value={question.options.join("\n")} onChange={(value) => patchQuestion(selected.id, question.id, { options: value.split("\n").map((item) => item.trim()).filter(Boolean) })} /></div>
                      <Toggle disabled={disabled} label="Pergunta ativa" value={question.active} onChange={(active) => patchQuestion(selected.id, question.id, { active })} />
                      <Toggle disabled={disabled} label="Obrigatória" value={question.required} onChange={(required) => patchQuestion(selected.id, question.id, { required })} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><BadgeCheck className="h-5 w-5 text-emerald-300" />Solicitações Recentes</CardTitle>
                <CardDescription>Últimos pedidos registrados para conferência operacional.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.requests.slice(0, 8).map((request) => (
                  <div className="grid gap-2 rounded-lg border border-zinc-800 p-3 text-sm md:grid-cols-[1fr_160px_160px]" key={request.id}>
                    <span className="min-w-0 truncate text-white">{request.requesterName} → {request.targetRank}</span>
                    <span className="text-zinc-400">{statusLabel(request.status)}</span>
                    <span className="text-zinc-500">{new Date(request.createdAt).toLocaleDateString("pt-BR")}</span>
                  </div>
                ))}
                {!data.requests.length ? <p className="py-8 text-center text-sm text-zinc-500">Nenhuma solicitação registrada ainda.</p> : null}
              </CardContent>
            </Card>
          </div>
        ) : (
          <Empty text="Crie ou selecione uma promoção para configurar." />
        )}
      </div>
    </div>
  );
}

function newPromotion(): PolicePromotionDefinition {
  return {
    id: crypto.randomUUID(),
    active: true,
    approvalRoleIds: [],
    categoryId: null,
    color: "#2563eb",
    description: "Solicitação de avaliação para promoção de patente.",
    emoji: "📋",
    evaluatorRoleIds: [],
    grantedRoleId: null,
    historyChannelId: null,
    logChannelId: null,
    name: "Nova promoção",
    panelChannelId: null,
    panelDescription: "Preencha o formulário para solicitar sua avaliação.",
    panelMessageId: null,
    panelTitle: "Solicitação de Avaliação",
    receivedRankName: "Nova patente",
    rejectedRoleIds: [],
    removedRoleId: null,
    requestNewEvaluationEnabled: true,
    questions: [newQuestion(0)]
  };
}

function newQuestion(order: number): PolicePromotionQuestion {
  return { id: crypto.randomUUID(), active: true, defaultValue: null, description: null, label: "Nome completo", maxLength: 120, options: [], order, placeholder: "Informe sua resposta", required: true, type: "short" };
}

function usesOptions(type: PolicePromotionQuestionType) {
  return type === "select" || type === "checkbox" || type === "radio";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    approved: "Aprovada",
    cancelled: "Cancelada",
    closed: "Fechada",
    in_evaluation: "Em avaliação",
    pending_approval: "Aguardando aprovação",
    rejected: "Reprovada",
    submitted: "Enviada",
    ticket_open: "Ticket aberto"
  };
  return labels[status] ?? status;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 text-2xl font-semibold text-white">{value}</p></div>;
}

function Toggle({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: boolean) => void; value: boolean }) {
  return <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 text-sm text-zinc-200">{label}<Switch checked={value} disabled={disabled} onCheckedChange={onChange} /></label>;
}

function Field({ disabled, label, onChange, type = "text", value }: { disabled: boolean; label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return <label className="grid gap-2 text-xs font-medium text-zinc-400">{label}<input className="h-11 rounded-lg border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none focus:border-blue-500/60 disabled:opacity-60" disabled={disabled} onChange={(event) => onChange(event.target.value)} type={type} value={value} /></label>;
}

function TextArea({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="grid gap-2 text-xs font-medium text-zinc-400">{label}<textarea className="min-h-24 rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500/60 disabled:opacity-60" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} /></label>;
}

function Select({ disabled, label, onChange, options, value }: { disabled: boolean; label: string; onChange: (value: string) => void; options: Array<{ id: string; name: string }>; value: string }) {
  return <label className="grid gap-2 text-xs font-medium text-zinc-400">{label}<select className="h-11 rounded-lg border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none focus:border-blue-500/60 disabled:opacity-60" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>;
}

function Empty({ loading = false, text }: { loading?: boolean; text: string }) {
  return <Card><CardContent className="flex min-h-48 items-center justify-center gap-2 text-sm text-zinc-500">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{text}</CardContent></Card>;
}

function readMessage(error: unknown) {
  if (error && typeof error === "object" && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) return response.data.message;
  }
  return error instanceof Error ? error.message : "Não foi possível carregar as configurações.";
}
