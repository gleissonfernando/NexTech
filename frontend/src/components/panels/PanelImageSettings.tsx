import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, FileVideo, Image, Loader2, Play, Plus, RefreshCw, Save, Trash2, Type, Upload } from "lucide-react";
import { getPanelImageSettings, listPanelImageSettings, removePanelImage, savePanelImageSettings, uploadPanelImage } from "../../lib/api";
import type {
  PanelImageLayoutMode,
  PanelBannerMode,
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
  defaultPosition?: PanelImagePosition;
  id: string;
  label: string;
};

const PANELS: PanelDefinition[] = [
  { id: "global-default", label: "Padrão visual global" },
  { id: "welcome", label: "Boas-vindas" },
  { id: "leave", label: "Saída" },
  { id: "rules", label: "Regras" },
  { id: "ticket", label: "Ticket" },
  { id: "ticket-logo", label: "Ticket - logo superior", defaultPosition: "thumbnail" },
  { id: "ticket-banner", label: "Ticket - banner principal", defaultPosition: "below_title" },
  { id: "ticket-banner-secondary", label: "Ticket - segundo banner", defaultPosition: "bottom" },
  { id: "ticket-footer", label: "Ticket - rodapé", defaultPosition: "footer" },
  { id: "live", label: "Live" },
  { id: "giveaway", label: "Sorteio" },
  { id: "safe-bot", label: "Self Bot" },
  { id: "mission-tools", label: "Mission Tools" },
  { id: "social-network", label: "Redes sociais" },
  { id: "logs", label: "Avisos e logs" },
  { id: "auto-activity-clock", label: "Ponto automático" },
  { id: "police-time-clock", label: "Relógio de ponto" },
  { id: "police-promotions", label: "Promoções" },
  { id: "police-qru", label: "QRU policial" },
  { id: "police-patrol-reports", label: "Relatórios policiais" },
  { id: "police-hidden-channel", label: "Canal oculto policial" },
  { id: "vehicle-abandonment", label: "Veículo abandonado" },
  { id: "police-open-duty", label: "Aviso de serviço aberto" },
  { id: "rh-admin", label: "Departamento de RH" },
  { id: "police-iab", label: "Corregedoria" },
  { id: "police-dm", label: "Avisos Administrativos" },
  { id: "visible-message", label: "Barra de mensagem" },
  { id: "message-control", label: "Controle de mensagem" },
  { id: "fivem-general", label: "FiveM geral" },
  { id: "fivem-absence", label: "Ausência FiveM" },
  { id: "fivem-actions", label: "Ações FiveM" },
  { id: "fivem-orders", label: "Encomendas FiveM" },
  { id: "fivem-finance", label: "Financeiro FiveM" },
  { id: "fivem-goals", label: "Metas FiveM" },
  { id: "fivem-captcha", label: "Captcha FiveM" },
  { id: "fivem-washing", label: "Lavagem FiveM" },
  { id: "fivem-drugs", label: "Drogas FiveM" },
  { id: "manual-registration", label: "Registro manual" },
  { id: "manual-payments", label: "Pagamentos manuais" },
  { id: "sales-tickets", label: "Tickets de vendas" },
  { id: "price-tables", label: "Tabelas de preço" },
  { id: "courses", label: "Cursos" },
  { id: "nextech-invites", label: "Convites NexTech" },
  { id: "ztk-webhook", label: "ZTK Webhook" },
  { id: "panels", label: "Painéis personalizados" }
];
const PANEL_MEDIA_ACCEPT = [
  "image/png", "image/apng", "image/avif", "image/jpeg", "image/jpg", "image/webp", "image/gif",
  "video/3gpp", "video/3gpp2", "video/mp4", "video/quicktime", "video/webm", "video/x-msvideo", "video/x-matroska", "video/mpeg", "video/mp2t", "video/x-flv", "video/x-ms-wmv", "video/ogg",
  ".png", ".apng", ".avif", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".mpeg", ".mpg", ".flv", ".wmv", ".ts", ".mts", ".3gp", ".3g2", ".ogv", ".asf", ".f4v", ".vob", ".rmvb", ".mxf"
].join(",");
const PANEL_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const PANEL_VIDEO_MAX_BYTES = 15 * 1024 * 1024;
const PANEL_VIDEO_MAX_DURATION_SECONDS = 15;
const VIDEO_METADATA_TIMEOUT_MS = 8000;
const VIDEO_LOAD_TIMEOUT_MS = 12000;

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

const bannerModeOptions: Array<{ label: string; value: PanelBannerMode }> = [
  { label: "Automático", value: "auto" },
  { label: "Grande", value: "large" },
  { label: "Compacto", value: "compact" },
  { label: "Horizontal", value: "horizontal" },
  { label: "Vertical", value: "vertical" },
  { label: "Quadrado", value: "square" },
  { label: "Ultrawide", value: "ultrawide" },
  { label: "Personalizado", value: "custom" }
];

const layoutOptions: Array<{ label: string; value: PanelImageLayoutMode }> = [
  { label: "Embed", value: "embed" },
  { label: "Components V2", value: "components_v2" }
];

const advancedPositions = new Set<PanelImagePosition>(["top", "below_title", "middle", "bottom", "before_buttons", "below_text", "above_buttons"]);
const FOOTER_IMAGE_PANEL_IDS = new Set(["ticket-footer"]);
const FOOTER_IMAGE_SIZE_PX = 32;

export function PanelImageSettings({ botId, canManage, componentsV2Only = false, guildId, panelId, panelLabel, panelSlots }: PanelImageSettingsProps) {
  const multiSlotMode = Boolean(panelSlots?.length);
  const fixedPanels = panelSlots?.length ? panelSlots : panelId ? [{ id: panelId, label: panelLabel ?? panelLabelForId(panelId) }] : null;
  const panelChoices = fixedPanels ?? PANELS;
  const requestedPanelId = fixedPanels?.[0]?.id ?? panelId ?? PANELS[0]?.id ?? "welcome";
  const panelSlotsKey = fixedPanels?.map((panel) => panel.id).join("|") ?? "";
  const [settingsByPanel, setSettingsByPanel] = useState<Record<string, PanelImageSettingsDto>>({});
  const [selectedPanelId, setSelectedPanelId] = useState(requestedPanelId);
  const [draft, setDraft] = useState<PanelImageSettingsDto>(() => defaultSettings("", "", requestedPanelId));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Array<{ label: string; status: "ok" | "warn" | "error"; value: string }> | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const fixedPanel = fixedPanels?.length === 1 ? fixedPanels[0] : null;
  const selectedPanel = panelChoices.find((panel) => panel.id === selectedPanelId) ?? panelChoices[0]!;
  const selectedFooterImagePanel = isFooterImagePanel(selectedPanelId);
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
      imagePosition: selectedFooterImagePanel
        ? "footer"
        : value.trim() && current.imagePosition === "none" ? selectedPanel.defaultPosition ?? "banner" : current.imagePosition,
      imageSize: selectedFooterImagePanel ? "custom" : current.imageSize,
      imageUrl: value,
      customHeight: selectedFooterImagePanel ? FOOTER_IMAGE_SIZE_PX : current.customHeight,
      customWidth: selectedFooterImagePanel ? FOOTER_IMAGE_SIZE_PX : current.customWidth,
      blocks: selectedFooterImagePanel ? [] : current.blocks,
      layoutMode: selectedFooterImagePanel ? "components_v2" : current.layoutMode,
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

    if (nextPayload.imageEnabled && nextPayload.imageUrl) {
      try {
        await validatePanelMediaUrl(nextPayload.imageUrl, draft.imageMimeType);
      } catch (validationError) {
        setStatus(null);
        setError(readErrorMessage(validationError, "A mídia informada não carregou. Confira a URL e tente novamente."));
        return;
      }
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

    setUploading(true);
    setUploadProgress(0);
    setStatus("Validando arquivo selecionado...");
    setError(null);
    logPanelUpload("selection", file, selectedPanelId);

    try {
      const uploadFile = await preparePanelUploadFile(file, selectedPanelId, (message) => setStatus(message));
      await validatePanelMediaBeforeUpload(uploadFile, (message) => setStatus(message));
      logPanelUpload("upload:start", uploadFile, selectedPanelId);
      setStatus("Enviando...\n░░░░░░░░░░ 0%");
      const saved = await uploadPanelImage(guildId, selectedPanelId, uploadFile, botId, (percent) => {
        setUploadProgress(percent);
        setStatus(percent >= 100 ? "Upload concluído. Processando no servidor..." : `Enviando...\n${progressBar(percent)} ${percent}%`);
      });
      logPanelUpload("upload:complete", uploadFile, selectedPanelId);
      setSettingsByPanel((current) => ({
        ...current,
        [saved.panelId]: saved
      }));
      setDraft(saved);
      setUploadProgress(100);
      setStatus("Mídia enviada e pré-visualização atualizada.");
    } catch (requestError) {
      logPanelUpload("upload:failed", file, selectedPanelId, readErrorMessage(requestError, "Falha desconhecida."));
      setStatus(null);
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

  async function diagnoseVideo() {
    if (!draft.imageUrl || !isVideoMedia(draft.imageUrl, draft.imageMimeType)) return;
    setDiagnosing(true);
    setDiagnostics(null);
    setStatus("Diagnosticando vídeo...");
    setError(null);

    try {
      setDiagnostics(await runVideoDiagnostics(draft));
      setStatus("Diagnóstico concluído.");
    } catch (requestError) {
      setError(readErrorMessage(requestError, "Não foi possível diagnosticar o vídeo."));
    } finally {
      setDiagnosing(false);
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
                      accept={PANEL_MEDIA_ACCEPT}
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
                  <span>PNG • JPG • WEBP • GIF • MP4 • WEBM • MOV • AVI • MKV • M4V</span>
                  {draft.imageUrl ? <ImageTypeBadge settings={draft} /> : null}
                </div>
                {uploading ? (
                  <div className="grid gap-1">
                    <div className="h-2 overflow-hidden rounded-full bg-zinc-800" aria-label={`Progresso do upload ${uploadProgress}%`}>
                      <div className="h-full bg-[#FFD500] transition-[width] duration-200" style={{ width: `${Math.max(0, Math.min(100, uploadProgress))}%` }} />
                    </div>
                    <p className="text-right text-[11px] text-zinc-500">{uploadProgress}%</p>
                  </div>
                ) : null}
              </div>

              <SelectField
                disabled={disabled || selectedFooterImagePanel}
                label="Posicao"
                onChange={(value) => updateDraft("imagePosition", value as PanelImagePosition)}
                options={positionOptions}
                value={draft.imagePosition}
              />
              <SelectField
                disabled={disabled || selectedFooterImagePanel}
                label="Tamanho"
                onChange={(value) => updateDraft("imageSize", value as PanelImageSize)}
                options={sizeOptions}
                value={draft.imageSize}
              />
              <SelectField
                disabled={disabled}
                label="Tipo de Banner"
                onChange={(value) => updateDraft("bannerMode", value as PanelBannerMode)}
                options={bannerModeOptions}
                value={draft.bannerMode}
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

            <div className="rounded-lg border border-zinc-900 bg-zinc-950/70 p-4">
              <p className="text-sm font-semibold text-zinc-100">Reprodução de mídia</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <ToggleField disabled={disabled} label="Loop" onChange={(value) => updateDraft("mediaLoop", value)} value={draft.mediaLoop} />
                <ToggleField disabled={disabled} label="Autoplay" onChange={(value) => updateDraft("mediaAutoplay", value)} value={draft.mediaAutoplay} />
                <ToggleField disabled={disabled} label="Silenciar" onChange={(value) => updateDraft("mediaMuted", value)} value={draft.mediaMuted} />
                <ToggleField disabled={disabled} label="Mostrar controles" onChange={(value) => updateDraft("mediaControls", value)} value={draft.mediaControls} />
                <SelectField disabled={disabled} label="Pré-carregamento" onChange={(value) => updateDraft("mediaPreload", value as PanelImageSettingsDto["mediaPreload"])} options={[{ label: "Metadados", value: "metadata" }, { label: "Automático", value: "auto" }, { label: "Nenhum", value: "none" }]} value={draft.mediaPreload} />
                <SelectField disabled={disabled} label="Ajuste" onChange={(value) => updateDraft("mediaFit", value as PanelImageSettingsDto["mediaFit"])} options={[{ label: "Cobrir painel", value: "cover" }, { label: "Conter painel", value: "contain" }]} value={draft.mediaFit} />
                <NumberField disabled={disabled} label="Volume inicial %" max={100} min={0} onChange={(value) => updateDraft("mediaVolume", Math.min(1, Math.max(0, value / 100)))} value={Math.round((draft.mediaVolume ?? 0) * 100)} />
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-zinc-200">Poster / Miniatura</span>
                  <input className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-[#FFD500]/60" disabled={disabled} onChange={(event) => updateDraft("mediaPosterUrl", event.target.value || null)} placeholder="Gerado automaticamente ou URL" value={draft.mediaPosterUrl ?? draft.mediaThumbnailUrl ?? ""} />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-900 bg-black p-4">
              <div className="mx-auto max-w-xl rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                {draft.imageEnabled && draft.imageUrl && ["top", "banner"].includes(draft.imagePosition) ? (
                  <PreviewImage alt={selectedPanel.label} imageUrl={draft.imageUrl} settings={draft} style={previewStyle} />
                ) : null}
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-zinc-100">{selectedPanel.label}</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      Texto do painel mantendo o layout atual. A imagem segue a posição e o tamanho selecionados.
                    </p>
                  </div>
                  {draft.imageEnabled && draft.imageUrl && draft.imagePosition === "thumbnail" ? (
                    <InlineMediaPreview className="h-20 w-20" imageUrl={draft.imageUrl} settings={draft} />
                  ) : null}
                  {draft.imageEnabled && draft.imageUrl && draft.imagePosition === "side" ? <InlineMediaPreview className="h-28 w-36" imageUrl={draft.imageUrl} settings={draft} /> : null}
                </div>
                {draft.imageEnabled && draft.imageUrl && ["below_title", "below_text"].includes(draft.imagePosition) ? (
                  <PreviewImage alt={selectedPanel.label} imageUrl={draft.imageUrl} settings={draft} style={previewStyle} />
                ) : null}
                {draft.imageEnabled && draft.imageUrl && ["middle"].includes(draft.imagePosition) ? <><p className="mt-3 text-sm text-zinc-400">Campos extras do painel</p><PreviewImage alt={selectedPanel.label} imageUrl={draft.imageUrl} settings={draft} style={previewStyle} /></> : null}
                {draft.imageEnabled && draft.imageUrl && ["before_buttons", "above_buttons"].includes(draft.imagePosition) ? (
                  <PreviewImage alt={selectedPanel.label} imageUrl={draft.imageUrl} settings={draft} style={previewStyle} />
                ) : null}
                {draft.imageEnabled && draft.imageUrl && draft.imagePosition === "bottom" ? (
                  <PreviewImage alt={selectedPanel.label} imageUrl={draft.imageUrl} settings={draft} style={previewStyle} />
                ) : null}
                {draft.imageEnabled && draft.imageUrl && draft.imagePosition === "footer" ? (
                  <div className="mt-4 flex items-center justify-start gap-2.5 border-t border-zinc-900 pt-3 text-xs text-zinc-500">
                    <InlineMediaPreview className="h-8 min-h-8 w-8 min-w-8 max-h-8 max-w-8 rounded-md" imageUrl={draft.imageUrl} settings={draft} />
                    <span className="flex items-center">{previewFooterText(draft)}</span>
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300">Botão principal</span>
                  <span className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300">Botão secundario</span>
                </div>
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
          {draft.imageUrl && isVideoMedia(draft.imageUrl, draft.imageMimeType) ? (
            <Button disabled={diagnosing} onClick={() => void diagnoseVideo()} type="button" variant="outline">
              {diagnosing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileVideo className="h-4 w-4" />}
              Diagnosticar Vídeo
            </Button>
          ) : null}
          {loading ? (
            <span className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Carregando...
            </span>
          ) : null}
        </div>

        {status ? <p className="text-xs text-emerald-400">{status}</p> : null}
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
        {diagnostics ? <VideoDiagnosticsReport items={diagnostics} /> : null}
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
  max = 2000,
  min = 16,
  onChange,
  value
}: {
  disabled: boolean;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium text-zinc-200">{label}</span>
      <input
        className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-[#FFD500]/60"
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || min)))}
        type="number"
        value={value}
      />
    </label>
  );
}

function ToggleField({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: boolean) => void; value: boolean }) {
  return <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-200"><span>{label}</span><Switch checked={value} disabled={disabled} onCheckedChange={onChange} /></label>;
}

function PreviewImage({
  alt,
  imageUrl,
  settings,
  style
}: {
  alt: string;
  imageUrl: string;
  settings: PanelImageSettingsDto;
  style: CSSProperties;
}) {
  const displayStyle = previewMediaStyle(settings, style);
  if (isVideoMedia(imageUrl, settings.imageMimeType)) {
    return <SmartVideoPreview alt={alt} className="mt-4" imageUrl={imageUrl} settings={settings} style={displayStyle} />;
  }

  return (
    <img
      alt={alt}
      className="mt-4 rounded-md border border-zinc-800"
      src={dashboardImageUrl(imageUrl)}
      style={displayStyle}
    />
  );
}

function InlineMediaPreview({ className, imageUrl, settings }: { className: string; imageUrl: string; settings: PanelImageSettingsDto }) {
  const classes = `${className} shrink-0 rounded-md border border-zinc-800`;
  const style = { objectFit: settings.imagePosition === "footer" ? "contain" : settings.mediaFit };
  if (isVideoMedia(imageUrl, settings.imageMimeType)) {
    return <SmartVideoPreview className={className} compact imageUrl={imageUrl} settings={settings} style={style} />;
  }
  return <img alt="" className={classes} src={dashboardImageUrl(imageUrl)} style={style} />;
}

function SmartVideoPreview({
  alt = "",
  className,
  compact = false,
  imageUrl,
  settings,
  style
}: {
  alt?: string;
  className: string;
  compact?: boolean;
  imageUrl: string;
  settings: PanelImageSettingsDto;
  style: CSSProperties;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [retry, setRetry] = useState(0);
  const [needsPlay, setNeedsPlay] = useState(false);
  const posterUrl = settings.mediaPosterUrl || settings.mediaThumbnailUrl || "";
  const src = withRetryCacheKey(dashboardImageUrl(imageUrl), retry);
  const poster = posterUrl ? dashboardImageUrl(posterUrl) : undefined;
  const showOverlay = loadState !== "ready";

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: "160px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setLoadState(visible ? "loading" : "idle");
    setNeedsPlay(false);
  }, [imageUrl, retry, visible]);

  useEffect(() => {
    if (!visible || loadState !== "loading") return;
    const timer = window.setTimeout(() => {
      console.warn("[media-engine-preview]", JSON.stringify({ imageUrl, retry, stage: "load:timeout" }));
      if (retry < 2) {
        setRetry((current) => current + 1);
      } else {
        setLoadState("error");
      }
    }, VIDEO_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [imageUrl, loadState, retry, visible]);

  function handleReady(event: React.SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    video.volume = Math.min(1, Math.max(0, settings.mediaVolume ?? 0));
    setLoadState("ready");
    console.info("[media-engine-preview]", JSON.stringify({ duration: video.duration, imageUrl, stage: "render:ready" }));

    if (settings.mediaAutoplay) {
      void video.play().then(() => {
        setNeedsPlay(false);
        console.info("[media-engine-preview]", JSON.stringify({ imageUrl, stage: "play:started" }));
      }).catch(() => {
        setNeedsPlay(true);
        console.info("[media-engine-preview]", JSON.stringify({ imageUrl, stage: "play:blocked" }));
      });
    }
  }

  function handleError() {
    console.warn("[media-engine-preview]", JSON.stringify({ imageUrl, retry, stage: "render:error" }));
    if (retry < 2) {
      setRetry((current) => current + 1);
      return;
    }
    setLoadState("error");
  }

  async function play() {
    const video = videoRef.current;
    if (!video) return;
    await video.play().then(() => setNeedsPlay(false)).catch(() => setNeedsPlay(true));
  }

  return (
    <div
      aria-label={alt}
      className={`${className} relative overflow-hidden rounded-md border border-zinc-800 bg-zinc-950`}
      ref={wrapperRef}
      style={style}
    >
      {visible ? (
        <video
          autoPlay={settings.mediaAutoplay}
          className="h-full w-full bg-transparent"
          controls={settings.mediaControls}
          key={`${imageUrl}-${retry}`}
          loop={settings.mediaLoop}
          muted={settings.mediaMuted}
          onCanPlay={handleReady}
          onError={handleError}
          onLoadedData={handleReady}
          playsInline
          poster={poster}
          preload={settings.mediaPreload === "none" ? "auto" : settings.mediaPreload}
          ref={videoRef}
          src={src}
          style={{ height: "100%", objectFit: settings.mediaFit, width: "100%" }}
        />
      ) : null}
      {poster && showOverlay ? <img alt="" className="absolute inset-0 h-full w-full object-cover" src={poster} /> : null}
      {showOverlay ? (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/55">
          <div className="flex items-center gap-2 rounded-md border border-zinc-700 bg-black/70 px-3 py-2 text-xs font-medium text-zinc-100">
            {loadState === "error" ? <AlertTriangle className="h-4 w-4 text-red-300" /> : <Loader2 className="h-4 w-4 animate-spin text-[#FFD500]" />}
            {loadState === "error" ? "Falha ao renderizar" : compact ? "Carregando" : "Preparando vídeo"}
          </div>
        </div>
      ) : null}
      {needsPlay ? (
        <button className="absolute inset-0 flex items-center justify-center bg-black/30" onClick={() => void play()} type="button">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#FFD500] text-black shadow-lg">
            <Play className="h-5 w-5 fill-current" />
          </span>
        </button>
      ) : null}
      {loadState === "error" ? (
        <button className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md border border-zinc-700 bg-black/80 px-2 py-1 text-xs text-white" onClick={() => { setRetry((current) => current + 1); setLoadState("loading"); }} type="button">
          <RefreshCw className="h-3.5 w-3.5" />
          Recarregar
        </button>
      ) : null}
    </div>
  );
}

function ImageTypeBadge({ settings }: { settings: PanelImageSettingsDto }) {
  const extension = (settings.imageExtension || extensionFromUrl(settings.imageUrl) || "").toLowerCase();
  const isVideo = isVideoMedia(settings.imageUrl, settings.imageMimeType);
  const isGif = settings.imageIsAnimated || settings.imageMimeType === "image/gif" || extension === "gif";
  const banner = classifyBanner(settings);
  const dimensions = banner.width && banner.height ? `${banner.width}x${banner.height}` : null;
  const label = isVideo ? `Vídeo ${extension ? extension.toUpperCase() : ""}`.trim() : isGif ? (settings.imageIsAnimated ? "GIF Animado" : "GIF") : extension ? extension.toUpperCase() : "Imagem";
  const icon = isVideo || isGif ? "🎞️" : "🖼️";
  const details = [
    dimensions,
    banner.kind,
    settings.imageMimeType,
    settings.imageSizeBytes ? formatBytes(settings.imageSizeBytes) : null
  ].filter(Boolean).join(" · ");

  return (
    <span className="rounded-md border border-zinc-800 bg-black px-2 py-1 text-zinc-300" title={details || undefined}>
      {icon} {label}{dimensions ? ` · ${dimensions}` : ""}
    </span>
  );
}

function VideoDiagnosticsReport({ items }: { items: Array<{ label: string; status: "ok" | "warn" | "error"; value: string }> }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <FileVideo className="h-4 w-4" />
        Diagnóstico do vídeo
      </p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const Icon = item.status === "ok" ? CheckCircle2 : item.status === "warn" ? AlertTriangle : AlertTriangle;
          const color = item.status === "ok" ? "text-emerald-300" : item.status === "warn" ? "text-amber-300" : "text-red-300";
          return (
            <div className="rounded-md border border-zinc-800 bg-black p-2 text-xs" key={item.label}>
              <span className={`mb-1 flex items-center gap-1 font-semibold ${color}`}><Icon className="h-3.5 w-3.5" />{item.label}</span>
              <span className="break-words text-zinc-300">{item.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isVideoMedia(imageUrl: string, mimeType?: string | null) {
  if (mimeType?.startsWith("video/")) return true;
  return /\.(3gp|3g2|asf|avi|f4v|flv|m4v|mkv|mov|mp4|mpeg|mpg|mts|mxf|ogv|rmvb|ts|vob|webm|wmv)(?:$|[?#])/i.test(imageUrl);
}

function previewMediaStyle(settings: PanelImageSettingsDto, baseStyle: CSSProperties): CSSProperties {
  if (["banner", "top", "below_title", "below_text", "middle", "bottom", "before_buttons", "above_buttons"].includes(settings.imagePosition)) {
    const banner = classifyBanner(settings);
    const compact = banner.mode === "compact";
    const vertical = banner.kind === "vertical";
    const square = banner.kind === "square";
    return {
      ...baseStyle,
      display: "block",
      height: isVideoMedia(settings.imageUrl, settings.imageMimeType) ? baseStyle.height ?? "auto" : "auto",
      marginLeft: "auto",
      marginRight: "auto",
      maxHeight: vertical ? "420px" : undefined,
      maxWidth: compact ? "72%" : vertical ? "58%" : square ? "68%" : "100%",
      objectFit: "contain",
      width: compact || vertical || square ? "auto" : "100%"
    };
  }

  return {
    ...baseStyle,
    objectFit: settings.mediaFit
  };
}

function classifyBanner(settings: PanelImageSettingsDto) {
  const width = settings.mediaDiagnostics?.width ?? null;
  const height = settings.mediaDiagnostics?.height ?? null;
  const ratio = width && height ? width / height : null;
  const automaticKind = ratio === null
    ? "horizontal"
    : ratio >= 2.1
      ? "ultrawide"
      : ratio > 1.15
        ? "horizontal"
        : ratio < 0.85
          ? "vertical"
          : "square";
  const requested = settings.bannerMode ?? "auto";
  const mode = requested === "compact" ? "compact" : requested === "large" ? "large" : "auto";
  const kind = ["horizontal", "vertical", "square", "ultrawide"].includes(requested) ? requested : automaticKind;
  return { height, kind, mode, ratio, width };
}

function previewFooterText(settings: PanelImageSettingsDto) {
  const now = new Date();
  const date = now.toLocaleDateString("pt-BR");
  const time = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const banner = classifyBanner(settings);
  const dimensions = banner.width && banner.height ? ` • ${banner.width}x${banner.height}` : "";
  return `${date} ${time} • Servidor${dimensions}`;
}

async function validatePanelMediaUrl(imageUrl: string, mimeType?: string | null) {
  const url = dashboardImageUrl(imageUrl.trim());
  if (!/^https?:\/\//i.test(url) && !url.startsWith("/api/persistent-images/")) {
    throw new Error("Use uma URL http/https válida ou envie uma mídia pelo upload.");
  }
  if (isVideoMedia(url, mimeType)) {
    await readRemoteVideoMetadata(url);
    return;
  }
  await loadImageUrl(url);
}

function loadImageUrl(url: string) {
  return new Promise<void>((resolve, reject) => {
    const image = new window.Image();
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("A imagem demorou demais para carregar."));
    }, VIDEO_METADATA_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
    };
    image.onload = () => {
      cleanup();
      resolve();
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("Não foi possível carregar a imagem. Confira a URL."));
    };
    image.src = url;
  });
}

async function runVideoDiagnostics(settings: PanelImageSettingsDto) {
  const url = dashboardImageUrl(settings.imageUrl);
  const metadata = settings.mediaDiagnostics;
  const browserMetadata = await readRemoteVideoMetadata(url).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
  const head = await fetch(url, { cache: "reload", method: "HEAD" }).then((response) => ({
    contentLength: response.headers.get("content-length"),
    contentType: response.headers.get("content-type"),
    ok: response.ok,
    range: response.headers.get("accept-ranges"),
    status: response.status
  })).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
  const canPlay = document.createElement("video").canPlayType(settings.imageMimeType || metadata?.outputMimeType || "video/mp4") || "indisponível";
  const items: Array<{ label: string; status: "ok" | "warn" | "error"; value: string }> = [];

  items.push({ label: "URL", status: "ok", value: url });
  items.push("ok" in head
    ? { label: "Acessibilidade", status: head.ok ? "ok" : "error", value: `HTTP ${head.status}` }
    : { label: "Acessibilidade", status: "error", value: head.error });
  items.push("ok" in head
    ? { label: "Streaming progressivo", status: head.range === "bytes" ? "ok" : "warn", value: head.range === "bytes" ? "Accept-Ranges ativo" : "Servidor não informou Accept-Ranges" }
    : { label: "Streaming progressivo", status: "error", value: "Não foi possível verificar" });
  items.push("ok" in head
    ? { label: "MIME servido", status: head.contentType?.startsWith("video/") ? "ok" : "warn", value: head.contentType || "Não informado" }
    : { label: "MIME servido", status: "error", value: "Não foi possível verificar" });
  items.push("ok" in head
    ? { label: "Tamanho servido", status: head.contentLength ? "ok" : "warn", value: head.contentLength ? formatBytes(Number(head.contentLength)) : "Não informado" }
    : { label: "Tamanho servido", status: "error", value: "Não foi possível verificar" });
  items.push({ label: "Formato", status: settings.imageMimeType?.startsWith("video/") ? "ok" : "warn", value: settings.imageMimeType || metadata?.outputMimeType || "Não identificado" });
  items.push({ label: "Processamento", status: settings.imageProcessingStatus === "failed" ? "warn" : "ok", value: settings.imageProcessingStatus === "converted" ? "Convertido para MP4 H.264/AAC" : settings.imageProcessingStatus === "stored" ? "Armazenado em formato compatível" : settings.imageProcessingError || "Sem histórico de processamento" });
  items.push({ label: "Codec de vídeo", status: metadata?.videoCodec ? "ok" : "warn", value: metadata?.videoCodec || "Não informado pelo arquivo antigo" });
  items.push({ label: "Codec de áudio", status: metadata?.audioCodec ? "ok" : "warn", value: metadata?.audioCodec || "Sem áudio ou não informado" });
  items.push({ label: "Compatibilidade", status: metadata?.browserCompatible === false ? "warn" : "ok", value: metadata ? (metadata.browserCompatible ? "Compatível após processamento" : "Arquivo antigo salvo antes da conversão") : canPlay });
  items.push({ label: "Resolução", status: metadata?.width && metadata.height ? "ok" : "warn", value: metadata?.width && metadata.height ? `${metadata.width}x${metadata.height}` : "Não informada" });
  items.push({ label: "FPS", status: metadata?.fps ? "ok" : "warn", value: metadata?.fps ? String(metadata.fps) : "Não informado" });
  items.push({ label: "Bitrate", status: metadata?.bitrate ? "ok" : "warn", value: metadata?.bitrate ? `${metadata.bitrate} kb/s` : "Não informado" });
  items.push({ label: "Duração", status: "duration" in browserMetadata || metadata?.durationSeconds ? "ok" : "warn", value: "duration" in browserMetadata ? `${formatSeconds(browserMetadata.duration)}s` : metadata?.durationSeconds ? `${formatSeconds(metadata.durationSeconds)}s` : browserMetadata.error });
  items.push({ label: "Poster", status: settings.mediaPosterUrl || settings.mediaThumbnailUrl ? "ok" : "warn", value: settings.mediaPosterUrl || settings.mediaThumbnailUrl || "Sem miniatura gerada" });
  items.push({ label: "Cache", status: "ok", value: "Cache HTTP imutável + recarregamento automático em falha" });
  items.push({ label: "Renderização", status: "duration" in browserMetadata ? "ok" : "error", value: "duration" in browserMetadata ? "Navegador carregou os metadados" : browserMetadata.error });

  return items;
}

function readRemoteVideoMetadata(url: string) {
  return new Promise<{ duration: number; height: number; width: number }>((resolve, reject) => {
    const video = document.createElement("video");
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Tempo limite ao carregar metadados remotos."));
    }, VIDEO_METADATA_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
    };
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const result = { duration: video.duration, height: video.videoHeight, width: video.videoWidth };
      cleanup();
      resolve(result);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("O navegador não conseguiu decodificar este vídeo."));
    };
    video.src = url;
  });
}

async function validatePanelMediaBeforeUpload(file: File, onStatus: (message: string) => void) {
  const allowedMime = isPanelMediaMime(file.type);
  const allowedExtension = isPanelMediaName(file.name);
  if (!allowedMime && !allowedExtension) {
    throw new Error("Formato não reconhecido. Envie imagem, GIF/animação ou vídeo comum como MP4, MOV, AVI, MKV, WEBM, M4V, MPEG, FLV, WMV, TS, 3GP, OGV, ASF, F4V, VOB, RMVB ou MXF.");
  }

  const video = isPanelVideoFile(file);
  const maxBytes = video ? PANEL_VIDEO_MAX_BYTES : PANEL_IMAGE_MAX_BYTES;
  if (file.size > maxBytes) {
    throw new Error(`Arquivo muito grande. O limite para ${video ? "vídeos" : "imagens"} é ${formatBytes(maxBytes)}.`);
  }

  if (!video) return;

  onStatus("Validando duração do vídeo...");
  const metadata = await readBrowserVideoMetadata(file).catch((error) => {
    console.info("[panel-media-upload]", JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      stage: "client_duration:skipped"
    }));
    return null;
  });
  if (!metadata) {
    onStatus("Duração será validada pelo servidor...");
    return;
  }
  if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) {
    throw new Error("Não foi possível validar a duração deste vídeo no navegador.");
  }
  if (metadata.duration > PANEL_VIDEO_MAX_DURATION_SECONDS) {
    throw new Error(`O vídeo tem ${formatSeconds(metadata.duration)}s. O tempo máximo permitido é de ${PANEL_VIDEO_MAX_DURATION_SECONDS} segundos.`);
  }
}

function readBrowserVideoMetadata(file: File) {
  return new Promise<{ duration: number }>((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Tempo limite ao ler metadados do vídeo no navegador."));
    }, VIDEO_METADATA_TIMEOUT_MS);

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      resolve({ duration });
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("O navegador não conseguiu ler os metadados deste formato."));
    };
    video.src = url;
  });
}

function isPanelVideoFile(file: File) {
  return file.type.startsWith("video/") || /\.(3gp|3g2|asf|avi|f4v|flv|m4v|mkv|mov|mp4|mpeg|mpg|mts|mxf|ogv|rmvb|ts|vob|webm|wmv)$/i.test(file.name);
}

function formatSeconds(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function logPanelUpload(stage: string, file: File, panelId: string, error?: string) {
  console.info("[panel-media-upload]", JSON.stringify({
    error,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    panelId,
    size: file.size,
    stage
  }));
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

function withRetryCacheKey(url: string, retry: number) {
  if (retry <= 0) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}retry=${retry}`;
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

function isPanelMediaMime(value: string) {
  if (!value) return false;
  return /^(image\/(apng|gif|jpe?g|png|webp)|video\/(3gpp2?|avi|mp2t|mp4|mpeg|ogg|quicktime|vnd\.dlna\.mpeg-tts|vnd\.rn-realvideo|webm|x-f4v|x-flv|x-m4v|x-matroska|x-ms-asf|x-ms-vob|x-ms-wmv|x-msvideo|x-mxf)|application\/mxf|application\/octet-stream)$/i.test(value);
}

function isPanelMediaName(value: string) {
  return /\.(apng|gif|jpe?g|png|webp|3gp|3g2|asf|avi|f4v|flv|m4v|mkv|mov|mp4|mpeg|mpg|mts|mxf|ogv|rmvb|ts|vob|webm|wmv)$/i.test(value);
}

function progressBar(percent: number) {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
}

function defaultSettings(guildId: string, botId: string, panelId: string): PanelImageSettingsDto {
  return {
    botId,
    customHeight: null,
    customWidth: null,
    guildId,
    bannerMode: "auto",
    imageEnabled: false,
    imageExtension: null,
    imageIsAnimated: false,
    imageMimeType: null,
    imageProcessingError: null,
    imageProcessingStatus: null,
    blocks: [],
    imagePosition: "none",
    imageSize: "medium",
    imageSizeBytes: null,
    imageUploadedAt: null,
    imageUrl: "",
    layoutMode: "embed",
    mediaAutoplay: true,
    mediaControls: false,
    mediaFit: "cover",
    mediaLoop: true,
    mediaMuted: true,
    mediaDiagnostics: null,
    mediaPosterUrl: null,
    mediaPreload: "metadata",
    mediaThumbnailUrl: null,
    mediaVolume: 0,
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
  const footerImagePanel = isFooterImagePanel(settings.panelId);

  return {
    customHeight: footerImagePanel ? FOOTER_IMAGE_SIZE_PX : settings.imageSize === "custom" ? settings.customHeight : null,
    customWidth: footerImagePanel ? FOOTER_IMAGE_SIZE_PX : settings.imageSize === "custom" ? settings.customWidth : null,
    bannerMode: settings.bannerMode ?? "auto",
    blocks: footerImagePanel || componentsV2Only ? [] : settings.blocks ?? [],
    imageEnabled,
    imagePosition: imageEnabled ? footerImagePanel ? "footer" : settings.imagePosition : "none",
    imageSize: footerImagePanel ? "custom" : settings.imageSize,
    imageUrl: imageEnabled ? imageUrl : "",
    layoutMode: footerImagePanel ? "components_v2" : layoutMode,
    mediaAutoplay: settings.mediaAutoplay,
    mediaControls: settings.mediaControls,
    mediaFit: settings.mediaFit,
    mediaLoop: settings.mediaLoop,
    mediaMuted: settings.mediaMuted,
    mediaPosterUrl: settings.mediaPosterUrl,
    mediaPreload: settings.mediaPreload,
    mediaThumbnailUrl: settings.mediaThumbnailUrl,
    mediaVolume: settings.mediaVolume,
    useGlobalDefault: footerImagePanel ? false : settings.useGlobalDefault
  };
}

function isFooterImagePanel(panelId: string) {
  return FOOTER_IMAGE_PANEL_IDS.has(panelId);
}

async function preparePanelUploadFile(file: File, panelId: string, onStatus: (message: string) => void) {
  if (!isFooterImagePanel(panelId) || !file.type.startsWith("image/") || typeof document === "undefined") {
    return file;
  }

  onStatus(`Redimensionando imagem do rodapé para ${FOOTER_IMAGE_SIZE_PX}x${FOOTER_IMAGE_SIZE_PX}px...`);
  return resizeImageFileToFooterIcon(file);
}

async function resizeImageFileToFooterIcon(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = FOOTER_IMAGE_SIZE_PX;
    canvas.height = FOOTER_IMAGE_SIZE_PX;
    const context = canvas.getContext("2d");
    if (!context) return file;

    context.clearRect(0, 0, FOOTER_IMAGE_SIZE_PX, FOOTER_IMAGE_SIZE_PX);
    const scale = Math.min(FOOTER_IMAGE_SIZE_PX / image.naturalWidth, FOOTER_IMAGE_SIZE_PX / image.naturalHeight);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const left = Math.round((FOOTER_IMAGE_SIZE_PX - width) / 2);
    const top = Math.round((FOOTER_IMAGE_SIZE_PX - height) / 2);
    context.drawImage(image, left, top, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Não foi possível redimensionar a imagem do rodapé.")), "image/png");
    });
    const baseName = file.name.replace(/\.[^.]+$/, "") || "footer";
    return new File([blob], `${baseName}-32x32.png`, { lastModified: Date.now(), type: "image/png" });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImageElement(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível ler a imagem selecionada."));
    image.src = url;
  });
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
  const response = typeof error === "object" && error !== null && "response" in error
    ? (error as { response?: { data?: { message?: unknown } } }).response
    : null;
  if (typeof response?.data?.message === "string") return response.data.message;

  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : null;
  if (code === "ECONNABORTED") return "O upload excedeu o tempo limite. Tente um arquivo menor ou outro formato de vídeo.";

  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
