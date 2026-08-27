import { AlertTriangle, CalendarClock, Edit3, Loader2, Megaphone, Plus, Save, Send, Settings, Trash2, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createSystemUpdate,
  deleteUpdateCategory,
  deleteUpdateRule,
  getGuildLiveOptions,
  getUpdatesDashboard,
  previewSystemUpdate,
  publishSystemUpdate,
  saveUpdateCategory,
  saveUpdateRule,
  saveUpdateSettings
} from "../../lib/api";
import type { DashboardGuild, GuildChannelOption, SaveSystemUpdatePayload, UpdateCategory, UpdatePreview, UpdatesDashboard } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

const DEFAULT_CHANNEL_ID = "1529352273958801499";

type Props = {
  botId: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

export function UpdatesPanel({ botId, canManage, guild }: Props) {
  const [dashboard, setDashboard] = useState<UpdatesDashboard | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<SaveSystemUpdatePayload>(() => ({
    autoClassify: true,
    changes: ["Adicionado novo sistema de inventário com suporte a peso."],
    date: new Date().toISOString(),
    description: "",
    publishNow: false,
    title: "",
    version: ""
  }));
  const [preview, setPreview] = useState<UpdatePreview | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<Partial<UpdateCategory>>({ channelId: DEFAULT_CHANNEL_ID, color: "#22c55e", emoji: "🆕", keywords: [], name: "" });
  const [ruleDraft, setRuleDraft] = useState({ categoryId: "", terms: "", priority: 50 });

  const ready = Boolean(botId && guild);
  const categoryById = useMemo(() => new Map((dashboard?.categories ?? []).map((category) => [category.id, category])), [dashboard?.categories]);

  useEffect(() => {
    if (!ready || !botId || !guild) return;
    let mounted = true;
    setLoading(true);
    Promise.all([
      getUpdatesDashboard(botId, guild.id),
      getGuildLiveOptions(guild.id, botId).catch(() => ({ channels: [] as GuildChannelOption[] }))
    ])
      .then(([nextDashboard, options]) => {
        if (!mounted) return;
        setDashboard(nextDashboard);
        setChannels(options.channels ?? []);
        setRuleDraft((current) => ({ ...current, categoryId: current.categoryId || nextDashboard.categories[0]?.id || "" }));
      })
      .catch((error) => setMessage(readError(error, "Não foi possível carregar Atualizações.")))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [botId, guild, ready]);

  async function refresh() {
    if (!botId || !guild) return;
    setDashboard(await getUpdatesDashboard(botId, guild.id));
  }

  async function buildPreview() {
    if (!botId || !guild) return;
    setSaving(true);
    setMessage(null);
    try {
      const nextPreview = await previewSystemUpdate(botId, guild.id, normalizedDraft());
      setPreview(nextPreview);
    } catch (error) {
      setMessage(readError(error, "Não foi possível gerar o preview."));
    } finally {
      setSaving(false);
    }
  }

  async function saveUpdate(publishNow = false) {
    if (!botId || !guild) return;
    setSaving(true);
    setMessage(null);
    try {
      await createSystemUpdate(botId, guild.id, { ...normalizedDraft(), publishNow });
      setMessage(publishNow ? "Atualização publicada." : "Atualização salva no histórico.");
      setPreview(null);
      setDraft({ autoClassify: true, changes: [""], date: new Date().toISOString(), description: "", title: "", version: "" });
      await refresh();
    } catch (error) {
      setMessage(readError(error, "Não foi possível salvar a atualização."));
    } finally {
      setSaving(false);
    }
  }

  async function saveSettingsPatch(patch: Partial<UpdatesDashboard["settings"]>) {
    if (!botId || !guild || !dashboard) return;
    setSaving(true);
    try {
      const settings = await saveUpdateSettings(botId, guild.id, patch);
      setDashboard({ ...dashboard, settings });
    } catch (error) {
      setMessage(readError(error, "Não foi possível salvar configurações."));
    } finally {
      setSaving(false);
    }
  }

  async function saveCategory() {
    if (!botId || !guild) return;
    setSaving(true);
    try {
      await saveUpdateCategory(botId, guild.id, {
        ...categoryDraft,
        keywords: splitLinesOrComma(categoryDraft.keywords?.join(",") ?? "")
      });
      setCategoryDraft({ channelId: DEFAULT_CHANNEL_ID, color: "#22c55e", emoji: "🆕", keywords: [], name: "" });
      await refresh();
    } catch (error) {
      setMessage(readError(error, "Não foi possível salvar categoria."));
    } finally {
      setSaving(false);
    }
  }

  async function saveRule() {
    if (!botId || !guild) return;
    setSaving(true);
    try {
      await saveUpdateRule(botId, guild.id, {
        categoryId: ruleDraft.categoryId,
        priority: ruleDraft.priority,
        terms: splitLinesOrComma(ruleDraft.terms)
      });
      setRuleDraft({ categoryId: dashboard?.categories[0]?.id ?? "", priority: 50, terms: "" });
      await refresh();
    } catch (error) {
      setMessage(readError(error, "Não foi possível salvar regra."));
    } finally {
      setSaving(false);
    }
  }

  function normalizedDraft(): SaveSystemUpdatePayload {
    return {
      ...draft,
      bannerUrl: draft.bannerUrl || null,
      changes: splitLines(String(draft.changes?.join("\n") ?? "")).map((text) => ({ text })),
      date: draft.date || new Date().toISOString(),
      finalCategoryIds: draft.finalCategoryIds?.filter(Boolean),
      scheduledFor: draft.scheduledFor || null,
      version: draft.version || null
    };
  }

  if (!guild || !botId) {
    return <Card><CardContent className="p-6 text-sm text-zinc-400">Selecione um bot e servidor para configurar Atualizações.</CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-4">
        <StatCard icon={Megaphone} label="Atualizações" value={dashboard?.stats.total ?? 0} />
        <StatCard icon={Plus} label="Novidades" value={dashboard?.stats.novidades ?? 0} />
        <StatCard icon={Edit3} label="Correções" value={dashboard?.stats.correcoes ?? 0} />
        <StatCard icon={CalendarClock} label="Agendadas" value={dashboard?.stats.scheduled ?? 0} />
      </div>

      {message ? <div className="rounded-lg border border-[#FFD500]/30 bg-[#FFD500]/10 px-4 py-3 text-sm text-[#FFEA70]">{message}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Criar Atualização</CardTitle>
          <CardDescription>Classifique automaticamente, confira o preview e publique no canal correto.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1fr_420px]">
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Título" value={draft.title ?? ""} onChange={(value) => setDraft({ ...draft, title: value })} />
              <Field label="Versão" value={draft.version ?? ""} onChange={(value) => setDraft({ ...draft, version: value })} />
              <Field label="Banner URL" value={draft.bannerUrl ?? ""} onChange={(value) => setDraft({ ...draft, bannerUrl: value })} />
            </div>
            <label className="block text-xs font-semibold uppercase text-zinc-500">Descrição</label>
            <textarea className="min-h-24 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-[#FFD500]/60" value={draft.description ?? ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            <label className="block text-xs font-semibold uppercase text-zinc-500">Lista de alterações</label>
            <textarea className="min-h-36 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-[#FFD500]/60" value={draft.changes?.map((item) => typeof item === "string" ? item : item.text).join("\n") ?? ""} onChange={(event) => setDraft({ ...draft, changes: splitLines(event.target.value) })} />
            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300">
                <Switch checked={draft.autoClassify !== false} onCheckedChange={(checked) => setDraft({ ...draft, autoClassify: checked })} />
                Classificação automática
              </label>
              <select className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white" value={draft.finalCategoryIds?.[0] ?? ""} onChange={(event) => setDraft({ ...draft, finalCategoryIds: event.target.value ? [event.target.value] : [] })}>
                <option value="">Categoria automática</option>
                {dashboard?.categories.map((category) => <option key={category.id} value={category.id}>{category.emoji} {category.name}</option>)}
              </select>
              <input className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none" type="datetime-local" onChange={(event) => setDraft({ ...draft, scheduledFor: event.target.value ? new Date(event.target.value).toISOString() : null })} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!canManage || saving} onClick={buildPreview} variant="secondary"><Edit3 className="mr-2 h-4 w-4" />Preview</Button>
              <Button disabled={!canManage || saving} onClick={() => saveUpdate(false)} variant="secondary"><Save className="mr-2 h-4 w-4" />Salvar</Button>
              <Button disabled={!canManage || saving} onClick={() => saveUpdate(true)}><Send className="mr-2 h-4 w-4" />Publicar agora</Button>
              {saving ? <Loader2 className="h-5 w-5 animate-spin text-zinc-500" /> : null}
            </div>
          </div>
          <PreviewBox preview={preview} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Canais de Atualizações</CardTitle>
          <CardDescription>Modo único usa o canal {DEFAULT_CHANNEL_ID}; modo por categoria respeita o canal de cada categoria.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <div className="space-y-3">
            <select className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white" value={dashboard?.settings.mode ?? "single"} onChange={(event) => saveSettingsPatch({ mode: event.target.value as "single" | "per_category" })} disabled={!canManage}>
              <option value="single">Canal único</option>
              <option value="per_category">Canais por categoria</option>
            </select>
            <ChannelSelect channels={channels} value={dashboard?.settings.singleChannelId ?? DEFAULT_CHANNEL_ID} onChange={(singleChannelId) => saveSettingsPatch({ singleChannelId })} disabled={!canManage} />
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {dashboard?.categories.map((category) => (
              <div key={category.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-white">{category.emoji} {category.name}</span>
                  <Badge variant={category.enabled ? "success" : "muted"}>{category.enabled ? "Ativa" : "Inativa"}</Badge>
                </div>
                <p className="mt-2 text-xs text-zinc-500">Canal: {channelName(channels, category.channelId) ?? category.channelId ?? "não configurado"}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Categorias</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 md:grid-cols-[1fr_80px_120px]">
              <Field label="Nome" value={categoryDraft.name ?? ""} onChange={(name) => setCategoryDraft({ ...categoryDraft, name })} />
              <Field label="Emoji" value={categoryDraft.emoji ?? ""} onChange={(emoji) => setCategoryDraft({ ...categoryDraft, emoji })} />
              <Field label="Cor" value={categoryDraft.color ?? "#22c55e"} onChange={(color) => setCategoryDraft({ ...categoryDraft, color })} />
            </div>
            <ChannelSelect channels={channels} value={categoryDraft.channelId ?? DEFAULT_CHANNEL_ID} onChange={(channelId) => setCategoryDraft({ ...categoryDraft, channelId })} disabled={!canManage} />
            <textarea className="min-h-20 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none" placeholder="Palavras-chave separadas por vírgula" onChange={(event) => setCategoryDraft({ ...categoryDraft, keywords: splitLinesOrComma(event.target.value) })} value={categoryDraft.keywords?.join(", ") ?? ""} />
            <Button disabled={!canManage || saving || !categoryDraft.name} onClick={saveCategory}><Plus className="mr-2 h-4 w-4" />Salvar categoria</Button>
            <div className="space-y-2">
              {dashboard?.categories.map((category) => (
                <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2" key={category.id}>
                  <span className="text-sm text-zinc-200">{category.emoji} {category.name}</span>
                  <Button disabled={!canManage} onClick={() => botId && guild && deleteUpdateCategory(botId, guild.id, category.id).then(refresh)} size="sm" variant="ghost"><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Regras Personalizadas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <select className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white" value={ruleDraft.categoryId} onChange={(event) => setRuleDraft({ ...ruleDraft, categoryId: event.target.value })}>
              {dashboard?.categories.map((category) => <option key={category.id} value={category.id}>{category.emoji} {category.name}</option>)}
            </select>
            <textarea className="min-h-20 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none" placeholder="Ex: corrigido, bug, erro" value={ruleDraft.terms} onChange={(event) => setRuleDraft({ ...ruleDraft, terms: event.target.value })} />
            <Button disabled={!canManage || saving || !ruleDraft.categoryId || !ruleDraft.terms} onClick={saveRule}><Settings className="mr-2 h-4 w-4" />Salvar regra</Button>
            <div className="space-y-2">
              {dashboard?.rules.map((rule) => (
                <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2" key={rule.id}>
                  <span className="text-sm text-zinc-200">{categoryById.get(rule.categoryId)?.name ?? "Categoria"}: {rule.terms.join(", ")}</span>
                  <Button disabled={!canManage} onClick={() => botId && guild && deleteUpdateRule(botId, guild.id, rule.id).then(refresh)} size="sm" variant="ghost"><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? <Loader2 className="h-5 w-5 animate-spin text-zinc-500" /> : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500"><tr><th className="py-2">Título</th><th>Categoria</th><th>Data</th><th>Status</th><th>Canal</th><th>Ações</th></tr></thead>
              <tbody>
                {dashboard?.updates.map((update) => (
                  <tr className="border-t border-zinc-900 text-zinc-300" key={update.id}>
                    <td className="py-3 text-white">{update.title}</td>
                    <td>{update.finalCategoryIds.map((id) => categoryById.get(id)?.name).filter(Boolean).join(", ") || "Automática"}</td>
                    <td>{formatDate(update.createdAt)}</td>
                    <td><Badge variant={update.status === "PUBLISHED" ? "success" : update.status === "ERROR" ? "danger" : "muted"}>{update.status}</Badge></td>
                    <td>{update.errorReason ?? "-"}</td>
                    <td><Button disabled={!canManage || update.status === "PUBLISHED"} onClick={() => publishSystemUpdate(botId, guild.id, update.id).then(refresh).catch((error) => setMessage(readError(error, "Falha ao publicar.")))} size="sm" variant="secondary">Publicar</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PreviewBox({ preview }: { preview: UpdatePreview | null }) {
  if (!preview) {
    return <div className="flex min-h-80 items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950 text-sm text-zinc-500">Preview da publicação</div>;
  }
  const message = preview.messages[0];
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Badge variant={preview.lowConfidence ? "warning" : "success"}>Confiança {preview.confidence}%</Badge>
        {preview.lowConfidence ? <span className="flex items-center gap-2 text-xs text-amber-300"><AlertTriangle className="h-4 w-4" />Classificação com baixa confiança.</span> : null}
      </div>
      <pre className="max-h-96 whitespace-pre-wrap rounded-lg bg-black/40 p-4 text-sm leading-6 text-zinc-200">{message?.content ?? "Sem conteúdo."}</pre>
      {message?.error ? <p className="mt-3 text-sm text-red-300">{message.error}</p> : null}
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return <Card><CardContent className="flex items-center gap-3 p-4"><Icon className="h-5 w-5 text-[#FFEA70]" /><div><p className="text-xs text-zinc-500">{label}</p><p className="text-2xl font-semibold text-white">{value}</p></div></CardContent></Card>;
}

function Field({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return <label className="block"><span className="mb-1 block text-xs font-semibold uppercase text-zinc-500">{label}</span><input className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-[#FFD500]/60" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function ChannelSelect({ channels, disabled, onChange, value }: { channels: GuildChannelOption[]; disabled?: boolean; onChange: (value: string | null) => void; value: string | null }) {
  return (
    <select className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white" disabled={disabled} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">Canal não configurado</option>
      <option value={DEFAULT_CHANNEL_ID}>#{DEFAULT_CHANNEL_ID}</option>
      {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
    </select>
  );
}

function splitLines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function splitLinesOrComma(value: string) {
  return value.split(/[\n,]/).map((line) => line.trim()).filter(Boolean);
}

function channelName(channels: GuildChannelOption[], id: string | null) {
  return channels.find((channel) => channel.id === id)?.name ?? null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "2-digit" }).format(new Date(value));
}

function readError(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
