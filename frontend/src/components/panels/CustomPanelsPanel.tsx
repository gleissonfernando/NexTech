import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, Loader2, Plus, RefreshCw, Save, Send, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import {
  createCustomPanelApi,
  createCustomPanelCategoryApi,
  deleteCustomPanelApi,
  deleteCustomPanelCategoryApi,
  duplicateCustomPanelApi,
  getCustomPanelsDashboard,
  getGuildLiveOptions,
  getGuildRoleOptions,
  publishCustomPanelApi,
  updateCustomPanelApi
} from "../../lib/api";
import type {
  CustomPanel,
  CustomPanelCategory,
  CustomPanelComponent,
  DashboardGuild,
  GuildChannelOption,
  GuildRoleOption,
  SaveCustomPanelPayload
} from "../../types";

type Draft = SaveCustomPanelPayload & { id?: string | null };

const emptyDraft: Draft = {
  afterMessage: "",
  authorName: "",
  bannerUrl: "",
  beforeMessage: "Escolha uma opção abaixo.",
  categoryId: "",
  channelId: "",
  color: "#FFD500",
  components: [{ customId: "custom_panel_action", label: "Abrir", style: "secondary", type: "button" }],
  description: "Descrição do painel.",
  emoji: "",
  footerText: "",
  mentionRoleId: "",
  name: "Novo Painel",
  panelType: "custom",
  thumbnailUrl: ""
};

export function CustomPanelsPanel({ botId, canManage, guild }: { botId: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [categories, setCategories] = useState<CustomPanelCategory[]>([]);
  const [panels, setPanels] = useState<CustomPanel[]>([]);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [componentsJson, setComponentsJson] = useState(formatComponents(emptyDraft.components));
  const [categoryName, setCategoryName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const activeCategoryId = selectedCategoryId || categories[0]?.id || "";
  const visiblePanels = useMemo(
    () => panels.filter((panel) => panel.categoryId === activeCategoryId),
    [activeCategoryId, panels]
  );

  useEffect(() => {
    if (!guild || !botId) return;
    void refresh();
  }, [botId, guild?.id]);

  useEffect(() => {
    const firstCategoryId = categories[0]?.id || "";
    if (!selectedCategoryId && firstCategoryId) setSelectedCategoryId(firstCategoryId);
  }, [categories, selectedCategoryId]);

  useEffect(() => {
    if (!activeCategoryId) return;
    const current = panels.find((panel) => panel.id === selectedPanelId && panel.categoryId === activeCategoryId) ?? visiblePanels[0] ?? null;
    if (current) {
      selectPanel(current);
    } else {
      createLocalDraft(activeCategoryId);
    }
  }, [activeCategoryId, panels.length]);

  if (!guild || !botId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Painéis</CardTitle>
          <CardDescription>Selecione um bot e um servidor para gerenciar os painéis.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const activeBotId = botId;
  const guildId = guild.id;

  async function refresh() {
    if (!guild || !botId) return;
    setLoading(true);
    setError(null);
    try {
      const [dashboard, options, roleOptions] = await Promise.all([
        getCustomPanelsDashboard(activeBotId, guildId),
        getGuildLiveOptions(guildId, activeBotId),
        getGuildRoleOptions(guildId, activeBotId)
      ]);
      setCategories(dashboard.categories);
      setPanels(dashboard.panels);
      setChannels(options.channels);
      setRoles(roleOptions);
      setStatus("Painéis sincronizados com o banco.");
    } catch (err) {
      setError(readApiError(err, "Não foi possível carregar os painéis."));
    } finally {
      setLoading(false);
    }
  }

  function selectPanel(panel: CustomPanel) {
    setSelectedPanelId(panel.id);
    const nextDraft: Draft = {
      id: panel.id,
      afterMessage: panel.afterMessage ?? "",
      authorName: panel.authorName ?? "",
      bannerUrl: panel.bannerUrl ?? "",
      beforeMessage: panel.beforeMessage ?? "",
      categoryId: panel.categoryId,
      channelId: panel.channelId ?? "",
      color: panel.color,
      components: panel.components,
      description: panel.description,
      emoji: panel.emoji ?? "",
      footerText: panel.footerText ?? "",
      mentionRoleId: panel.mentionRoleId ?? "",
      name: panel.name,
      panelType: panel.panelType,
      thumbnailUrl: panel.thumbnailUrl ?? ""
    };
    setDraft(nextDraft);
    setComponentsJson(formatComponents(panel.components));
  }

  function createLocalDraft(categoryId = activeCategoryId) {
    setSelectedPanelId(null);
    const next = { ...emptyDraft, categoryId };
    setDraft(next);
    setComponentsJson(formatComponents(next.components));
  }

  async function createCategory() {
    if (!categoryName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const category = await createCustomPanelCategoryApi(activeBotId, guildId, { name: categoryName.trim(), order: categories.length + 1 });
      setCategories((current) => [...current, category].sort((a, b) => a.order - b.order));
      setSelectedCategoryId(category.id);
      setCategoryName("");
      setStatus("Categoria criada.");
    } catch (err) {
      setError(readApiError(err, "Não foi possível criar a categoria."));
    } finally {
      setSaving(false);
    }
  }

  async function removeCategory(categoryId: string) {
    setSaving(true);
    setError(null);
    try {
      await deleteCustomPanelCategoryApi(activeBotId, guildId, categoryId);
      setCategories((current) => current.filter((category) => category.id !== categoryId));
      setStatus("Categoria excluída.");
    } catch (err) {
      setError(readApiError(err, "Não foi possível excluir a categoria."));
    } finally {
      setSaving(false);
    }
  }

  async function savePanel() {
    setSaving(true);
    setError(null);
    try {
      const payload = buildPayload();
      await validateCustomPanelMedia(payload);
      const panel = draft.id
        ? await updateCustomPanelApi(activeBotId, guildId, draft.id, payload)
        : await createCustomPanelApi(activeBotId, guildId, payload);
      upsertPanel(panel);
      selectPanel(panel);
      setStatus("Painel salvo e enviado para sincronização.");
    } catch (err) {
      setError(readApiError(err, "Não foi possível salvar o painel."));
    } finally {
      setSaving(false);
    }
  }

  async function publishPanel() {
    if (!draft.id) {
      await savePanel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await validateCustomPanelMedia(buildPayload());
      const panel = await publishCustomPanelApi(activeBotId, guildId, draft.id);
      upsertPanel(panel);
      selectPanel(panel);
      setStatus(panel.messageId ? "Painel atualizado no Discord." : "Publicação enviada ao bot. O ID da mensagem será salvo automaticamente.");
    } catch (err) {
      setError(readApiError(err, "Não foi possível publicar o painel."));
    } finally {
      setSaving(false);
    }
  }

  async function duplicatePanel() {
    if (!draft.id) return;
    setSaving(true);
    setError(null);
    try {
      const panel = await duplicateCustomPanelApi(activeBotId, guildId, draft.id);
      upsertPanel(panel);
      selectPanel(panel);
      setStatus("Painel duplicado.");
    } catch (err) {
      setError(readApiError(err, "Não foi possível duplicar o painel."));
    } finally {
      setSaving(false);
    }
  }

  async function removePanel() {
    if (!draft.id) {
      createLocalDraft();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await deleteCustomPanelApi(activeBotId, guildId, draft.id);
      setPanels((current) => current.filter((panel) => panel.id !== draft.id));
      createLocalDraft();
      setStatus("Painel excluído.");
    } catch (err) {
      setError(readApiError(err, "Não foi possível excluir o painel."));
    } finally {
      setSaving(false);
    }
  }

  function buildPayload(): SaveCustomPanelPayload {
    let components: CustomPanelComponent[] = [];
    try {
      const parsed = JSON.parse(componentsJson || "[]");
      components = Array.isArray(parsed) ? parsed : [];
    } catch {
      throw new Error("JSON dos componentes inválido.");
    }
    const { id: _id, ...payload } = draft;
    return {
      ...payload,
      categoryId: draft.categoryId || activeCategoryId,
      components
    };
  }

  function upsertPanel(panel: CustomPanel) {
    setPanels((current) => {
      const next = current.filter((item) => item.id !== panel.id);
      return [panel, ...next];
    });
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="border-[#FFD500]/20 bg-[#0b0b0b]">
        <CardHeader>
          <CardTitle>Painéis</CardTitle>
          <CardDescription>Categorias e painéis publicados por este bot.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <input className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]/60" disabled={!canManage || saving} onChange={(event) => setCategoryName(event.target.value)} placeholder="Nova categoria" value={categoryName} />
            <Button disabled={!canManage || saving || !categoryName.trim()} onClick={() => void createCategory()} size="sm" type="button"><Plus className="h-4 w-4" /></Button>
          </div>

          <div className="space-y-2">
            {categories.map((category) => (
              <div className="flex gap-2" key={category.id}>
                <button className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-left text-sm transition ${activeCategoryId === category.id ? "border-[#FFD500]/50 bg-[#FFD500]/10 text-[#FFEA70]" : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700"}`} onClick={() => setSelectedCategoryId(category.id)} type="button">
                  <span className="block truncate font-semibold">{category.name}</span>
                  <span className="text-xs text-zinc-500">{panels.filter((panel) => panel.categoryId === category.id).length} painel(is)</span>
                </button>
                <button className="h-12 w-10 rounded-lg border border-zinc-800 text-zinc-500 transition hover:border-red-500/50 hover:text-red-300 disabled:opacity-40" disabled={!canManage || saving} onClick={() => void removeCategory(category.id)} title="Excluir categoria" type="button">
                  <Trash2 className="mx-auto h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="border-t border-zinc-900 pt-4">
            <Button disabled={!canManage || !activeCategoryId} onClick={() => createLocalDraft()} type="button"><Plus className="mr-2 h-4 w-4" />Novo Painel</Button>
          </div>

          <div className="space-y-2">
            {visiblePanels.map((panel) => (
              <button className={`w-full rounded-lg border px-3 py-2 text-left transition ${draft.id === panel.id ? "border-[#FFD500]/50 bg-[#FFD500]/10" : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"}`} key={panel.id} onClick={() => selectPanel(panel)} type="button">
                <span className="block truncate text-sm font-semibold text-white">{panel.name}</span>
                <span className="text-xs text-zinc-500">{panel.published ? "Publicado" : "Rascunho"} {panel.messageId ? `• ${panel.messageId}` : ""}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-[#FFD500]/20 bg-[#0b0b0b]">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>{draft.id ? "Editar Painel" : "Novo Painel"}</CardTitle>
            <CardDescription>Salve no banco e publique sem reiniciar o bot.</CardDescription>
          </div>
          <Button onClick={() => void refresh()} variant="secondary" type="button"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
        </CardHeader>
        <CardContent className="space-y-5">
          {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
          {status ? <div className="rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 px-3 py-2 text-sm text-[#FFEA70]">{status}</div> : null}

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nome" onChange={(name) => setDraft((current) => ({ ...current, name }))} value={draft.name} />
            <Field label="Cor da embed" onChange={(color) => setDraft((current) => ({ ...current, color }))} value={draft.color ?? ""} />
            <SelectField label="Canal" onChange={(channelId) => setDraft((current) => ({ ...current, channelId }))} value={draft.channelId ?? ""}>
              <option value="">Selecione o canal</option>
              {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
            </SelectField>
            <SelectField label="Cargo mencionado" onChange={(mentionRoleId) => setDraft((current) => ({ ...current, mentionRoleId }))} value={draft.mentionRoleId ?? ""}>
              <option value="">Nenhum</option>
              {roles.map((role) => <option key={role.id} value={role.id}>@{role.name}</option>)}
            </SelectField>
            <Field label="Thumbnail" onChange={(thumbnailUrl) => setDraft((current) => ({ ...current, thumbnailUrl }))} value={draft.thumbnailUrl ?? ""} />
            <Field label="Banner" onChange={(bannerUrl) => setDraft((current) => ({ ...current, bannerUrl }))} value={draft.bannerUrl ?? ""} />
            <Field label="Autor" onChange={(authorName) => setDraft((current) => ({ ...current, authorName }))} value={draft.authorName ?? ""} />
            <Field label="Rodapé" onChange={(footerText) => setDraft((current) => ({ ...current, footerText }))} value={draft.footerText ?? ""} />
          </div>

          <TextArea label="Descrição" onChange={(description) => setDraft((current) => ({ ...current, description }))} rows={4} value={draft.description ?? ""} />
          <TextArea label="Mensagem antes da embed" onChange={(beforeMessage) => setDraft((current) => ({ ...current, beforeMessage }))} rows={3} value={draft.beforeMessage ?? ""} />
          <TextArea label="Mensagem depois da embed" onChange={(afterMessage) => setDraft((current) => ({ ...current, afterMessage }))} rows={3} value={draft.afterMessage ?? ""} />
          <TextArea label="Componentes V2 em JSON" onChange={setComponentsJson} rows={10} value={componentsJson} />

          <CustomPanelPreview draft={draft} />

          <div className="flex flex-wrap gap-2">
            <Button disabled={!canManage || saving} onClick={() => void savePanel()} type="button">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salvar</Button>
            <Button disabled={!canManage || saving || !draft.channelId} onClick={() => void publishPanel()} type="button"><Send className="mr-2 h-4 w-4" />Publicar Painel</Button>
            <Button disabled={!canManage || saving || !draft.id} onClick={() => void duplicatePanel()} type="button" variant="secondary"><Copy className="mr-2 h-4 w-4" />Duplicar</Button>
            <Button disabled={!canManage || saving} onClick={() => void removePanel()} type="button" variant="destructive"><Trash2 className="mr-2 h-4 w-4" />Excluir</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return <label className="block text-sm font-medium text-zinc-300">{label}<input className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]/60" onChange={(event) => onChange(event.target.value)} value={value} /></label>;
}

function SelectField({ children, label, onChange, value }: { children: ReactNode; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="block text-sm font-medium text-zinc-300">{label}<select className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]/60" onChange={(event) => onChange(event.target.value)} value={value}>{children}</select></label>;
}

function TextArea({ label, onChange, rows, value }: { label: string; onChange: (value: string) => void; rows: number; value: string }) {
  return <label className="block text-sm font-medium text-zinc-300">{label}<textarea className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-[#FFD500]/60" onChange={(event) => onChange(event.target.value)} rows={rows} value={value} /></label>;
}

function formatComponents(components: CustomPanelComponent[] | undefined) {
  return JSON.stringify(components ?? [], null, 2);
}

function readApiError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function CustomPanelPreview({ draft }: { draft: Draft }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="mb-3 text-sm font-semibold text-white">Preview Components V2</p>
      <div className="rounded-lg border-l-4 bg-[#101012] p-4" style={{ borderLeftColor: /^#[0-9a-f]{6}$/i.test(draft.color ?? "") ? draft.color! : "#FFD500" }}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-white">{draft.emoji ? `${draft.emoji} ` : ""}{draft.name || "Painel"}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{draft.description || "Descrição do painel."}</p>
          </div>
          {draft.thumbnailUrl ? <img alt="Thumbnail" className="h-20 w-20 rounded-md border border-zinc-800 object-cover" src={draft.thumbnailUrl} /> : null}
        </div>
        {draft.bannerUrl ? <MediaPreview className="mt-4 block w-full rounded-md border border-zinc-800 object-contain" url={draft.bannerUrl} /> : null}
        {draft.beforeMessage ? <p className="mt-4 whitespace-pre-wrap text-sm text-zinc-300">{draft.beforeMessage}</p> : null}
        {draft.afterMessage ? <p className="mt-4 whitespace-pre-wrap text-sm text-zinc-400">{draft.afterMessage}</p> : null}
        {draft.footerText ? <p className="mt-4 border-t border-zinc-800 pt-3 text-xs text-zinc-500">{draft.footerText}</p> : null}
      </div>
    </div>
  );
}

function MediaPreview({ className, url }: { className: string; url: string }) {
  if (isVideoUrl(url)) {
    return <video className={className} controls muted playsInline preload="metadata" src={url} />;
  }
  return <img alt="Banner" className={className} src={url} />;
}

async function validateCustomPanelMedia(payload: SaveCustomPanelPayload) {
  if (payload.thumbnailUrl) {
    assertHttpMediaUrl(payload.thumbnailUrl, "Thumbnail/Rodapé");
    if (isVideoUrl(payload.thumbnailUrl)) throw new Error("Thumbnail/Rodapé deve ser imagem. Use vídeo somente no banner.");
    await loadMediaUrl(payload.thumbnailUrl, false);
  }
  if (payload.bannerUrl) {
    assertHttpMediaUrl(payload.bannerUrl, "Banner");
    await loadMediaUrl(payload.bannerUrl, isVideoUrl(payload.bannerUrl));
  }
}

function assertHttpMediaUrl(url: string, label: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return;
  } catch {
    // Fall through to the friendly validation message below.
  }
  throw new Error(`${label}: use uma URL http/https válida.`);
}

function loadMediaUrl(url: string, video: boolean) {
  return new Promise<void>((resolve, reject) => {
    let media: HTMLImageElement | HTMLVideoElement | null = null;
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("A mídia demorou demais para carregar. Confira a URL."));
    }, 8000);
    const cleanup = () => {
      window.clearTimeout(timer);
      if (!media) return;
      media.onload = null;
      media.onerror = null;
      if (media instanceof HTMLVideoElement) media.onloadedmetadata = null;
    };
    if (video) {
      const element = document.createElement("video");
      media = element;
      element.onloadedmetadata = () => { cleanup(); resolve(); };
      element.onerror = () => { cleanup(); reject(new Error("Não foi possível carregar o vídeo do banner.")); };
      element.preload = "metadata";
      element.src = url;
      return;
    }
    const image = new Image();
    media = image;
    image.onload = () => { cleanup(); resolve(); };
    image.onerror = () => { cleanup(); reject(new Error("Não foi possível carregar a imagem configurada.")); };
    image.src = url;
  });
}

function isVideoUrl(url: string) {
  return /\.(3gp|3g2|asf|avi|f4v|flv|m4v|mkv|mov|mp4|mpeg|mpg|mts|mxf|ogv|rmvb|ts|vob|webm|wmv)(?:$|[?#])/i.test(url);
}
