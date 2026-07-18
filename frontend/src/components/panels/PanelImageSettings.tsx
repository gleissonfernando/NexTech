import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Image, Loader2, Plus, Save, Trash2, Type, Upload } from "lucide-react";
import { getPanelImageSettings, listPanelImageSettings, removePanelImage, savePanelImageSettings, uploadPanelImage } from "../../lib/api";
import type {
  PanelImageLayoutMode,
  PanelImagePosition,
  PanelBlock,
  PanelImageSettings as PanelImageSettingsDto,
  PanelImageSize,
  SavePanelImageSettingsPayload
} from "../../types";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type PanelImageSettingsProps = {
  botId?: string | null;
  canManage: boolean;
  componentsV2Only?: boolean;
  guildId?: string | null;
  panelId?: string;
  panelLabel?: string;
  panelSlots?: PanelDefinition[];
};

type PanelDefinition = {
  id: string;
  label: string;
};

const PANELS: PanelDefinition[] = [
  { id: "welcome", label: "Boas-vindas" },
  { id: "leave", label: "Saída" },
  { id: "rules", label: "Regras" },
  { id: "ticket", label: "Ticket" },
  { id: "live", label: "Live" },
  { id: "giveaway", label: "Sorteio" },
  { id: "safe-bot", label: "Self Bot" },
  { id: "mission-tools", label: "Mission Tools" },
  { id: "social-network", label: "Redes sociais" },
  { id: "logs", label: "Avisos e logs" }
];

const positionOptions: Array<{ label: string; value: PanelImagePosition }> = [
  { label: "Sem imagem", value: "none" },
  { label: "Banner principal", value: "banner" },
  { label: "Miniatura", value: "thumbnail" },
  { label: "Lateral", value: "side" },
  { label: "Topo do painel", value: "top" },
  { label: "Abaixo do titulo", value: "below_title" },
  { label: "Meio do conteúdo", value: "middle" },
  { label: "Final do painel", value: "bottom" },
  { label: "Antes dos botões", value: "before_buttons" },
  { label: "Imagem no rodapé", value: "footer" }
];

const sizeOptions: Array<{ label: string; value: PanelImageSize }> = [
  { label: "Pequena", value: "small" },
  { label: "Media", value: "medium" },
  { label: "Grande", value: "large" },
  { label: "Banner completo", value: "full_banner" },
  { label: "Personalizado", value: "custom" }
];

const layoutOptions: Array<{ label: string; value: PanelImageLayoutMode }> = [
  { label: "Embed", value: "embed" },
  { label: "Components V2", value: "components_v2" }
];

const advancedPositions = new Set<PanelImagePosition>(["top", "below_title", "middle", "bottom", "before_buttons", "below_text", "above_buttons"]);

export function PanelImageSettings({ botId, canManage, componentsV2Only = false, guildId, panelId, panelLabel, panelSlots }: PanelImageSettingsProps) {
  const multiSlotMode = Boolean(panelSlots?.length);
  const fixedPanels = panelSlots?.length ? panelSlots.slice(0, 3) : panelId ? [{ id: panelId, label: panelLabel ?? panelLabelForId(panelId) }] : null;
  const panelChoices = fixedPanels ?? PANELS;
  const requestedPanelId = fixedPanels?.[0]?.id ?? panelId ?? PANELS[0]?.id ?? "welcome";
  const panelSlotsKey = fixedPanels?.map((panel) => panel.id).join("|") ?? "";
  const [settingsByPanel, setSettingsByPanel] = useState<Record<string, PanelImageSettingsDto>>({});
  const [selectedPanelId, setSelectedPanelId] = useState(requestedPanelId);
  const [draft, setDraft] = useState<PanelImageSettingsDto>(() => defaultSettings("", "", requestedPanelId));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fixedPanel = fixedPanels?.length === 1 ? fixedPanels[0] : null;
  const selectedPanel = panelChoices.find((panel) => panel.id === selectedPanelId) ?? panelChoices[0]!;
  const disabled = !canManage || !guildId || !botId || loading || saving || uploading;
  const effectiveLayoutMode = componentsV2Only || advancedPositions.has(draft.imagePosition) ? "components_v2" : draft.layoutMode;
  const previewStyle = previewImageStyle(draft.imageSize, draft.customWidth, draft.customHeight);

  useEffect(() => {
    if (fixedPanels?.length && !fixedPanels.some((panel) => panel.id === selectedPanelId)) {
      setSelectedPanelId(fixedPanels[0]!.id);
    } else if (panelId && panelId !== selectedPanelId && !fixedPanels?.length) {
      setSelectedPanelId(panelId);
    }
  }, [panelId, panelSlotsKey, selectedPanelId]);

  useEffect(() => {
    if (!guildId || !botId) {
      setSettingsByPanel({});
      setDraft(defaultSettings(guildId ?? "", botId ?? "", selectedPanelId));
      return;
    }

    let active = true;

    setLoading(true);
    setError(null);
    const request = fixedPanels
      ? Promise.all(fixedPanels.map((panel) => getPanelImageSettings(guildId, panel.id, botId)))
      : panelId
        ? getPanelImageSettings(guildId, panelId, botId).then((item) => [item])
      : listPanelImageSettings(guildId, botId);

    request.then((items) => {
        if (!active) return;
        setSettingsByPanel(Object.fromEntries(items.map((item) => [item.panelId, item])));
      })
      .catch((requestError) => {
        if (!active) return;
        setError(readErrorMessage(requestError, "Não foi possível carregar imagens dos painéis."));
        setSettingsByPanel({});
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [botId, guildId, panelId, panelSlotsKey]);

  function updateImageUrl(value: string) {
    setDraft((current) => ({
      ...current,
      imageEnabled: value.trim() ? true : current.imageEnabled,
      imagePosition: value.trim() && current.imagePosition === "none" ? "banner" : current.imagePosition,
      imageUrl: value,
      useGlobalDefault: value.trim() && selectedPanelId !== "global-default" ? false : current.useGlobalDefault
    }));
  }

  useEffect(() => {
    setDraft(settingsByPanel[selectedPanelId] ?? defaultSettings(guildId ?? "", botId ?? "", selectedPanelId));
  }, [botId, guildId, selectedPanelId, settingsByPanel]);

  const savedCount = useMemo(
    () => Object.values(settingsByPanel).filter((item) => item.imageEnabled && item.imageUrl).length,
    [settingsByPanel]
  );

  function updateDraft<K extends keyof PanelImageSettingsDto>(key: K, value: PanelImageSettingsDto[K]) {
    setDraft((current) => {
      const next = {
        ...current,
        [key]: value,
        ...(key !== "useGlobalDefault" && selectedPanelId !== "global-default" ? { useGlobalDefault: false } : {})
      };

      if (key === "imagePosition" && advancedPositions.has(value as PanelImagePosition)) {
        next.layoutMode = "components_v2";
      }

      if (key === "imagePosition" && value === "none") {
        next.imageEnabled = false;
      }

      return next;
    });
  }

  function blocks() {
    return (draft.blocks ?? []).slice().sort((a, b) => a.order - b.order);
  }

  function setBlocks(nextBlocks: PanelBlock[]) {
    updateDraft("blocks", nextBlocks.map((block, order) => ({ ...block, order })) as PanelImageSettingsDto["blocks"]);
  }

  function addBannerBlock() {
    const url = draft.imageUrl || "";
    setBlocks([...blocks(), { id: blockId(), items: [{ description: "Banner do painel", url }], order: blocks().length, type: "media_gallery" }]);
  }

  function addTextBlock() {
    setBlocks([...blocks(), { editable: true, id: blockId(), order: blocks().length, type: "text", content: "Texto do painel" }]);
  }

  function addFooterBlock() {
    setBlocks([...blocks(), { altText: "Imagem de rodapé", id: blockId(), imageUrl: draft.imagePosition === "footer" ? draft.imageUrl : "", order: blocks().length, text: "-# Rodapé do painel", type: "footer" }]);
  }

  function addSeparatorBlock() {
    setBlocks([...blocks(), { divider: true, id: blockId(), order: blocks().length, spacing: "small", type: "separator" }]);
  }

  function updateBlock(id: string, patch: Partial<PanelBlock>) {
    setBlocks(blocks().map((block) => block.id === id ? ({ ...block, ...patch } as PanelBlock) : block));
  }

  function moveBlock(id: string, direction: -1 | 1) {
    const list = blocks();
    const index = list.findIndex((block) => block.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return;
    [list[index], list[nextIndex]] = [list[nextIndex]!, list[index]!];
    setBlocks(list);
  }

  function removeBlock(id: string) {
    setBlocks(blocks().filter((block) => block.id !== id));
  }

  async function save(payload?: SavePanelImageSettingsPayload) {
    if (!guildId || !botId || disabled) {
      return;
    }

    const nextPayload = payload ?? buildPayload(draft, effectiveLayoutMode, componentsV2Only);

    if (nextPayload.imageEnabled && !String(nextPayload.imageUrl ?? "").trim()) {
      setStatus(null);
      setError("Informe a URL da imagem antes de salvar.");
      return;
    }

    setSaving(true);
    setStatus(null);
    setError(null);

    try {
      const saved = await savePanelImageSettings(guildId, selectedPanelId, nextPayload, botId);
      setSettingsByPanel((current) => ({
        ...current,
        [saved.panelId]: saved
      }));
      setDraft(saved);
      setStatus("Imagem do painel salva.");
    } catch (requestError) {
      setError(readErrorMessage(requestError, "Não foi possível salvar a imagem do painel."));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(file: File | null) {
    if (!file || !guildId || !botId || disabled) {
      return;
    }

    const allowedMime = ["image/gif", "image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"].includes(file.type);
    const allowedExtension = /\.(gif|jpe?g|mov|mp4|png|webm|webp)$/i.test(file.name);
    if (!allowedMime && !allowedExtension) {
      setStatus(null);
      setError("Envie uma imagem PNG, JPG, WEBP, GIF ou um vídeo MP4, MOV ou WEBM.");
      return;
    }

    setUploading(true);
    setStatus(null);
    setError(null);

    try {
      const saved = await uploadPanelImage(guildId, selectedPanelId, file, botId);
      setSettingsByPanel((current) => ({
        ...current,
        [saved.panelId]: saved
      }));
      setDraft(saved);
      setStatus("Mídia enviada e salva no painel.");
    } catch (requestError) {
      setError(readErrorMessage(requestError, "Não foi possível enviar a mídia."));
    } finally {
      setUploading(false);
    }
  }

  async function removeImage() {
    if (!guildId || !botId || disabled) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const saved = await removePanelImage(guildId, selectedPanelId, botId);
      setSettingsByPanel((current) => ({
        ...current,
        [saved.panelId]: saved
      }));
      setDraft(saved);
      setStatus("Imagem removida do painel.");
    } catch (requestError) {
      setError(readErrorMessage(requestError, "NÃ£o foi possÃ­vel remover a imagem."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-black">
              <Image className="h-5 w-5 text-zinc-300" />
            </div>
            <div>
              <CardTitle>{multiSlotMode ? `Banners do painel: ${panelLabel ?? selectedPanel.label}` : fixedPanel ? `Imagem do painel: ${selectedPanel.label}` : "Imagens dos painéis"}</CardTitle>
              <CardDescription>{multiSlotMode ? `Configure até ${panelChoices.length} banner(s) deste painel.` : fixedPanel ? "Configure a imagem deste painel." : `${savedCount} painel(is) com imagem configurada.`}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">{draft.imageEnabled ? "Ativo" : "Inativo"}</span>
            <Switch
              checked={draft.imageEnabled}
              disabled={disabled}
              onCheckedChange={(checked) => updateDraft("imageEnabled", checked)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className={fixedPanel ? "grid gap-4" : "grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]"}>
          {!fixedPanel ? (
            <aside className="max-h-[420px] space-y-2 overflow-y-auto rounded-lg border border-zinc-900 bg-zinc-950/70 p-2">
              {panelChoices.map((panel) => {
                const selected = panel.id === selectedPanelId;
                const configured = settingsByPanel[panel.id]?.imageEnabled;

                return (
                  <button
                    className={[
                      "flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border px-3 text-left text-sm transition",
                      selected
                        ? "border-[#FFEA70]/50 bg-[#FFD500]/10 text-white"
                        : "border-zinc-900 bg-black text-zinc-300 hover:border-zinc-700 hover:text-white"
                    ].join(" ")}
                    key={panel.id}
                    onClick={() => setSelectedPanelId(panel.id)}
                    type="button"
                  >
                    <span className="min-w-0 truncate">{panel.label}</span>
                    <span className={configured ? "text-xs text-emerald-300" : "text-xs text-zinc-600"}>
                      {configured ? "on" : "off"}
                    </span>
                  </button>
                );
              })}
            </aside>
          ) : null}

          <div className="space-y-4">
            {selectedPanelId !== "global-default" ? <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-300"><span><strong className="block text-zinc-100">Usar padrão visual global</strong>Desative para personalizar somente este módulo.</span><Switch checked={draft.useGlobalDefault} disabled={disabled} onCheckedChange={(checked) => updateDraft("useGlobalDefault", checked)} /></label> : null}
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs leading-5 text-blue-100">Topo/banner destacam a imagem primeiro; thumbnail/lateral mantêm o texto ao lado; meio e abaixo do título dividem o conteúdo; antes dos botões destaca a ação; final e rodapé encerram o painel.</div>
            {draft.imageInvalidReason ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">{draft.imageInvalidReason}</div> : null}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {!fixedPanel ? <label className="grid gap-2 text-sm">
                <span className="font-medium text-zinc-200">Painel</span>
                <select
                  className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-[#FFD500]/60"
                  disabled={disabled}
                  onChange={(event) => setSelectedPanelId(event.target.value)}
                  value={selectedPanelId}
                >
                  {panelChoices.map((panel) => (
                    <option key={panel.id} value={panel.id}>{panel.label}</option>
                  ))}
                </select>
              </label> : null}

              <div className="grid gap-2 text-sm xl:col-span-2">
                <span className="font-medium text-zinc-200">Imagem</span>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-600">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {uploading ? "Enviando..." : "Enviar mídia"}
                    <input
                      accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,video/mp4,video/quicktime,video/webm,.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.webm"
                      className="hidden"
                      disabled={disabled}
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        event.target.value = "";
                        void handleUpload(file);
                      }}
                      type="file"
                    />
                  </label>
                  <input
                    className="min-h-11 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-[#FFD500]/60"
                    disabled={disabled}
                    onChange={(event) => updateImageUrl(event.target.value)}
                    placeholder="Cole uma URL HTTPS ou envie uma mídia"
                    type="url"
                    value={draft.imageUrl}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span>PNG • JPG • JPEG • WEBP • GIF</span>
                  {draft.imageUrl ? <ImageTypeBadge settings={draft} /> : null}
                </div>
              </div>

              <SelectField
                disabled={disabled}
                label="Posicao"
                onChange={(value) => updateDraft("imagePosition", value as PanelImagePosition)}
                options={positionOptions}
                value={draft.imagePosition}
              />
              <SelectField
                disabled={disabled}
                label="Tamanho"
                onChange={(value) => updateDraft("imageSize", value as PanelImageSize)}
                options={sizeOptions}
                value={draft.imageSize}
              />
              {!componentsV2Only ? (
                <SelectField
                  disabled={disabled || advancedPositions.has(draft.imagePosition)}
                  label="Layout"
                  onChange={(value) => updateDraft("layoutMode", value as PanelImageLayoutMode)}
                  options={layoutOptions}
                  value={effectiveLayoutMode}
                />
              ) : (
                <div className="grid gap-2 text-sm">
                  <span className="font-medium text-zinc-200">Layout</span>
                  <div className="flex h-11 items-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 text-sm font-medium text-emerald-200">
                    Components V2
                  </div>
                </div>
              )}
            </div>

            {draft.imageSize === "custom" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField disabled={disabled} label="Largura" onChange={(value) => updateDraft("customWidth", value)} value={draft.customWidth ?? 320} />
                <NumberField disabled={disabled} label="Altura" onChange={(value) => updateDraft("customHeight", value)} value={draft.customHeight ?? 180} />
              </div>
            ) : null}

            <div className="rounded-lg border border-zinc-900 bg-black p-4">
              <div className="mx-auto max-w-xl rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                {draft.imageEnabled && draft.imageUrl && ["top", "banner"].includes(draft.imagePosition) ? (
                  <PreviewImage alt={selectedPanel.label} imageUrl={draft.imageUrl} mimeType={draft.imageMimeType} style={previewStyle} />
                ) : null}
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-zinc-100">{selectedPanel.label}</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      Texto do painel mantendo o layout atual. A imagem segue a posição e o tamanho selecionados.
                    </p>
                  </div>
                  {draft.imageEnabled && draft.imageUrl && draft.imagePosition === "thumbnail" ? (
                    <InlineMediaPreview className="h-20 w-20" imageUrl={draft.imageUrl} mimeType={draft.imageMimeType} />
                  ) : null}
                  {draft.imageEnabled && draft.imageUrl && draft.imagePosition === "side" ? <InlineMediaPreview className="h-28 w-36" imageUrl={draft.imageUrl} mimeType={draft.imageMimeType} /> : null}
                </div>
                {draft.imageEnabled && draft.imageUrl && ["below_title", "below_text"].includes(draft.imagePosition) ? (
                  <PreviewImage alt={selectedPanel.label} imageUrl={draft.imageUrl} mimeType={draft.imageMimeType} style={previewStyle} />
                ) : null}
                {draft.imageEnabled && draft.imageUrl && ["middle"].includes(draft.imagePosition) ? <><p className="mt-3 text-sm text-zinc-400">Campos extras do painel</p><PreviewImage alt={selectedPanel.label} imageUrl={draft.imageUrl} mimeType={draft.imageMimeType} style={previewStyle} /></> : null}
                {draft.imageEnabled && draft.imageUrl && ["before_buttons", "above_buttons"].includes(draft.imagePosition) ? (
                  <PreviewImage alt={selectedPanel.label} imageUrl={draft.imageUrl} mimeType={draft.imageMimeType} style={previewStyle} />
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300">Botão principal</span>
                  <span className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300">Botão secundario</span>
                </div>
                {draft.imageEnabled && draft.imageUrl && draft.imagePosition === "bottom" ? (
                  <PreviewImage alt={selectedPanel.label} imageUrl={draft.imageUrl} mimeType={draft.imageMimeType} style={previewStyle} />
                ) : null}
                {draft.imageEnabled && draft.imageUrl && draft.imagePosition === "footer" ? (
                  <div className="mt-4 flex items-center gap-2 border-t border-zinc-900 pt-3 text-xs text-zinc-500">
                    <InlineMediaPreview className="h-5 w-5 rounded-full" imageUrl={draft.imageUrl} mimeType={draft.imageMimeType} />
                    Rodapé do painel
                  </div>
                ) : null}
              </div>
            </div>

            {!componentsV2Only ? <div className="rounded-lg border border-zinc-900 bg-zinc-950/70 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Blocos dinamicos Components V2</p>
                  <p className="mt-1 text-xs text-zinc-500">A ordem dos blocos vira a ordem real dentro do Container do Discord.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={disabled} onClick={addBannerBlock} type="button" variant="outline"><Plus className="h-4 w-4" />Adicionar banner</Button>
                  <Button disabled={disabled} onClick={addTextBlock} type="button" variant="outline"><Type className="h-4 w-4" />Texto</Button>
                  <Button disabled={disabled} onClick={addFooterBlock} type="button" variant="outline"><Image className="h-4 w-4" />Rodapé</Button>
                  <Button disabled={disabled} onClick={addSeparatorBlock} type="button" variant="ghost">Separador</Button>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {blocks().length ? blocks().map((block, index) => (
                  <div className="rounded-lg border border-zinc-800 bg-black p-3" key={block.id}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{blockLabel(block)}</span>
                      <div className="flex gap-1">
                        <Button disabled={disabled || index === 0} onClick={() => moveBlock(block.id, -1)} size="icon" type="button" variant="ghost"><ArrowUp className="h-4 w-4" /></Button>
                        <Button disabled={disabled || index === blocks().length - 1} onClick={() => moveBlock(block.id, 1)} size="icon" type="button" variant="ghost"><ArrowDown className="h-4 w-4" /></Button>
                        <Button disabled={disabled} onClick={() => removeBlock(block.id)} size="icon" type="button" variant="ghost"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    {block.type === "media_gallery" ? (
                      <div className="grid gap-2 md:grid-cols-[1fr_180px]">
                        <input className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100" disabled={disabled} onChange={(event) => updateBlock(block.id, { items: [{ ...(block.items[0] ?? {}), url: event.target.value }] } as Partial<PanelBlock>)} placeholder="URL do banner" value={block.items[0]?.url ?? ""} />
                        <input className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100" disabled={disabled} onChange={(event) => updateBlock(block.id, { items: [{ ...(block.items[0] ?? {}), description: event.target.value }] } as Partial<PanelBlock>)} placeholder="Descrição" value={block.items[0]?.description ?? ""} />
                      </div>
                    ) : null}
                    {block.type === "text" ? (
                      <textarea className="min-h-20 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100" disabled={disabled} onChange={(event) => updateBlock(block.id, { content: event.target.value } as Partial<PanelBlock>)} value={block.content} />
                    ) : null}
                    {block.type === "separator" ? (
                      <label className="flex items-center gap-2 text-sm text-zinc-300"><input checked={block.divider !== false} disabled={disabled} onChange={(event) => updateBlock(block.id, { divider: event.target.checked } as Partial<PanelBlock>)} type="checkbox" />Exibir linha divisoria</label>
                    ) : null}
                    {block.type === "section" ? (
                      <div className="grid gap-2">
                        <textarea className="min-h-20 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100" disabled={disabled} onChange={(event) => updateBlock(block.id, { texts: event.target.value.split(/\n{2,}/).slice(0, 3) } as Partial<PanelBlock>)} value={block.texts.join("\n\n")} />
                        <input className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100" disabled={disabled} onChange={(event) => updateBlock(block.id, { accessory: { kind: "thumbnail", url: event.target.value } } as Partial<PanelBlock>)} placeholder="URL da thumbnail" value={block.accessory?.kind === "thumbnail" ? block.accessory.url : ""} />
                      </div>
                    ) : null}
                    {block.type === "footer" ? (
                      <div className="grid gap-2">
                        <textarea className="min-h-20 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100" disabled={disabled} onChange={(event) => updateBlock(block.id, { text: event.target.value } as Partial<PanelBlock>)} value={block.text} />
                        <div className="grid gap-2 md:grid-cols-2">
                          <input className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100" disabled={disabled} onChange={(event) => updateBlock(block.id, { imageUrl: event.target.value, attachmentName: null } as Partial<PanelBlock>)} placeholder="URL HTTPS da miniatura" value={block.imageUrl ?? ""} />
                          <input className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100" disabled={disabled} onChange={(event) => updateBlock(block.id, { altText: event.target.value } as Partial<PanelBlock>)} placeholder="Texto alternativo" value={block.altText ?? ""} />
                        </div>
                        <input className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100" disabled={disabled} onChange={(event) => updateBlock(block.id, { attachmentName: event.target.value, imageUrl: null } as Partial<PanelBlock>)} placeholder="Attachment local opcional: arquivo.png" value={block.attachmentName ?? ""} />
                      </div>
                    ) : null}
                  </div>
                )) : <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-sm text-zinc-500">Nenhum bloco dinamico configurado.</p>}
              </div>
            </div> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-900 pt-4">
          <Button disabled={disabled} onClick={() => void save()} type="button">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar imagem
          </Button>
          <Button disabled={disabled || (!draft.imageEnabled && !draft.imageUrl)} onClick={removeImage} type="button" variant="outline">
            <Trash2 className="h-4 w-4" />
            Remover imagem
          </Button>
          <Button disabled={disabled} onClick={() => { setDraft(defaultSettings(guildId ?? "", botId ?? "", selectedPanelId)); setStatus("Padrão restaurado. Clique em salvar para confirmar."); }} type="button" variant="ghost">Restaurar padrão</Button>
          {loading ? (
            <span className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Carregando...
            </span>
          ) : null}
        </div>

        {status ? <p className="text-xs text-emerald-400">{status}</p> : null}
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function SelectField({
  disabled,
  label,
  onChange,
  options,
  value
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium text-zinc-200">{label}</span>
      <select
        className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-[#FFD500]/60"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  disabled,
  label,
  onChange,
  value
}: {
  disabled: boolean;
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium text-zinc-200">{label}</span>
      <input
        className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-[#FFD500]/60"
        disabled={disabled}
        max={2000}
        min={16}
        onChange={(event) => onChange(Math.min(2000, Math.max(16, Number(event.target.value) || 16)))}
        type="number"
        value={value}
      />
    </label>
  );
}

function PreviewImage({
  alt,
  imageUrl,
  mimeType,
  style
}: {
  alt: string;
  imageUrl: string;
  mimeType?: string | null;
  style: { height: string; maxWidth: string; width: string };
}) {
  if (isVideoMedia(imageUrl, mimeType)) {
    return (
      <video
        className="mt-4 rounded-md border border-zinc-800 object-cover"
        controls
        loop
        muted
        playsInline
        src={dashboardImageUrl(imageUrl)}
        style={style}
      />
    );
  }

  return (
    <img
      alt={alt}
      className="mt-4 rounded-md border border-zinc-800 object-cover"
      src={dashboardImageUrl(imageUrl)}
      style={style}
    />
  );
}

function InlineMediaPreview({ className, imageUrl, mimeType }: { className: string; imageUrl: string; mimeType?: string | null }) {
  const classes = `${className} shrink-0 rounded-md border border-zinc-800 object-cover`;
  if (isVideoMedia(imageUrl, mimeType)) {
    return <video className={classes} loop muted playsInline src={dashboardImageUrl(imageUrl)} />;
  }
  return <img alt="" className={classes} src={dashboardImageUrl(imageUrl)} />;
}

function ImageTypeBadge({ settings }: { settings: PanelImageSettingsDto }) {
  const extension = (settings.imageExtension || extensionFromUrl(settings.imageUrl) || "").toLowerCase();
  const isVideo = isVideoMedia(settings.imageUrl, settings.imageMimeType);
  const isGif = settings.imageIsAnimated || settings.imageMimeType === "image/gif" || extension === "gif";
  const label = isVideo ? `Vídeo ${extension ? extension.toUpperCase() : ""}`.trim() : isGif ? (settings.imageIsAnimated ? "GIF Animado" : "GIF") : extension ? extension.toUpperCase() : "Imagem";
  const icon = isVideo || isGif ? "🎞️" : "🖼️";
  const details = [
    settings.imageMimeType,
    settings.imageSizeBytes ? formatBytes(settings.imageSizeBytes) : null
  ].filter(Boolean).join(" · ");

  return (
    <span className="rounded-md border border-zinc-800 bg-black px-2 py-1 text-zinc-300" title={details || undefined}>
      {icon} {label}
    </span>
  );
}

function isVideoMedia(imageUrl: string, mimeType?: string | null) {
  if (mimeType?.startsWith("video/")) return true;
  return /\.(mov|mp4|webm)(?:$|[?#])/i.test(imageUrl);
}

function dashboardImageUrl(imageUrl: string) {
  try {
    const url = new URL(imageUrl);
    if (url.pathname.startsWith("/api/persistent-images/")) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    // Relative URLs are already safe for the current dashboard origin.
  }

  return imageUrl;
}

function extensionFromUrl(value: string) {
  const match = value.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  return match?.[1] ?? "";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function defaultSettings(guildId: string, botId: string, panelId: string): PanelImageSettingsDto {
  return {
    botId,
    customHeight: null,
    customWidth: null,
    guildId,
    imageEnabled: false,
    imageExtension: null,
    imageIsAnimated: false,
    imageMimeType: null,
    blocks: [],
    imagePosition: "none",
    imageSize: "medium",
    imageSizeBytes: null,
    imageUploadedAt: null,
    imageUrl: "",
    layoutMode: "embed",
    panelId,
    updatedAt: null,
    useGlobalDefault: panelId !== "global-default"
  };
}

function blockId() {
  return `blk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function blockLabel(block: PanelBlock) {
  if (block.type === "media_gallery") return "Banner / Media Gallery";
  if (block.type === "section") return "Section com thumbnail";
  if (block.type === "footer") return "Rodapé com miniatura";
  if (block.type === "text") return "Texto";
  if (block.type === "separator") return "Separador";
  return "Botões";
}

function panelLabelForId(panelId: string) {
  return PANELS.find((panel) => panel.id === panelId)?.label ?? panelId;
}

function buildPayload(settings: PanelImageSettingsDto, layoutMode: PanelImageLayoutMode, componentsV2Only = false): SavePanelImageSettingsPayload {
  const imageUrl = settings.imageUrl.trim();
  const imageEnabled = settings.imageEnabled && settings.imagePosition !== "none" && Boolean(imageUrl);

  return {
    customHeight: settings.imageSize === "custom" ? settings.customHeight : null,
    customWidth: settings.imageSize === "custom" ? settings.customWidth : null,
    blocks: componentsV2Only ? [] : settings.blocks ?? [],
    imageEnabled,
    imagePosition: imageEnabled ? settings.imagePosition : "none",
    imageSize: settings.imageSize,
    imageUrl: imageEnabled ? imageUrl : "",
    layoutMode,
    useGlobalDefault: settings.useGlobalDefault
  };
}

function previewImageStyle(size: PanelImageSize, customWidth: number | null, customHeight: number | null) {
  if (size === "small") {
    return { height: "72px", maxWidth: "160px", width: "42%" };
  }

  if (size === "large") {
    return { height: "220px", maxWidth: "100%", width: "100%" };
  }

  if (size === "full_banner") {
    return { height: "260px", maxWidth: "100%", width: "100%" };
  }

  if (size === "custom") {
    return {
      height: `${customHeight ?? 180}px`,
      maxWidth: "100%",
      width: `${customWidth ?? 320}px`
    };
  }

  return { height: "150px", maxWidth: "100%", width: "72%" };
}

function readErrorMessage(error: unknown, fallback: string) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return fallback;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string"
    ? response.data.message
    : fallback;
}
