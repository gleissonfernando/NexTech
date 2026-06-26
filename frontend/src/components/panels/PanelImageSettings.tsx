import { useEffect, useMemo, useState } from "react";
import { Image, Loader2, Save, Trash2, Upload } from "lucide-react";
import { listPanelImageSettings, savePanelImageSettings, uploadPanelImage } from "../../lib/api";
import type {
  PanelImageLayoutMode,
  PanelImagePosition,
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
  guildId?: string | null;
  panelId?: string;
  panelLabel?: string;
};

type PanelDefinition = {
  id: string;
  label: string;
};

const PANELS: PanelDefinition[] = [
  { id: "welcome", label: "Boas-vindas" },
  { id: "leave", label: "Saida" },
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
  { label: "Banner embaixo", value: "banner" },
  { label: "Miniatura direita", value: "thumbnail" },
  { label: "Topo", value: "top" },
  { label: "Abaixo do texto", value: "below_text" },
  { label: "Acima dos botoes", value: "above_buttons" },
  { label: "Rodape", value: "footer" }
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

const advancedPositions = new Set<PanelImagePosition>(["top", "below_text", "above_buttons"]);

export function PanelImageSettings({ botId, canManage, guildId, panelId, panelLabel }: PanelImageSettingsProps) {
  const [settingsByPanel, setSettingsByPanel] = useState<Record<string, PanelImageSettingsDto>>({});
  const [selectedPanelId, setSelectedPanelId] = useState(panelId ?? PANELS[0]?.id ?? "welcome");
  const [draft, setDraft] = useState<PanelImageSettingsDto>(() => defaultSettings("", "", selectedPanelId));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fixedPanel = panelId ? { id: panelId, label: panelLabel ?? panelLabelForId(panelId) } : null;
  const selectedPanel = fixedPanel ?? PANELS.find((panel) => panel.id === selectedPanelId) ?? PANELS[0]!;
  const disabled = !canManage || !guildId || !botId || loading || saving || uploading;
  const effectiveLayoutMode = advancedPositions.has(draft.imagePosition) ? "components_v2" : draft.layoutMode;
  const previewStyle = previewImageStyle(draft.imageSize, draft.customWidth, draft.customHeight);

  useEffect(() => {
    if (panelId && panelId !== selectedPanelId) {
      setSelectedPanelId(panelId);
    }
  }, [panelId, selectedPanelId]);

  useEffect(() => {
    if (!guildId || !botId) {
      setSettingsByPanel({});
      setDraft(defaultSettings(guildId ?? "", botId ?? "", selectedPanelId));
      return;
    }

    let active = true;

    setLoading(true);
    setError(null);
    listPanelImageSettings(guildId, botId)
      .then((items) => {
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
  }, [botId, guildId]);

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
        [key]: value
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

  async function save(payload?: SavePanelImageSettingsPayload) {
    if (!guildId || !botId || disabled) {
      return;
    }

    const nextPayload = payload ?? buildPayload(draft, effectiveLayoutMode);

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

    if (!["image/gif", "image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setStatus(null);
      setError("Envie uma imagem GIF, PNG, JPG ou WEBP.");
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
      setStatus("Imagem enviada e salva no painel.");
    } catch (requestError) {
      setError(readErrorMessage(requestError, "Não foi possível enviar a imagem."));
    } finally {
      setUploading(false);
    }
  }

  function removeImage() {
    void save({
      customHeight: null,
      customWidth: null,
      imageEnabled: false,
      imagePosition: "none",
      imageSize: "medium",
      imageUrl: "",
      layoutMode: "embed"
    });
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
              <CardTitle>{fixedPanel ? `Imagem do painel: ${selectedPanel.label}` : "Imagens dos painéis"}</CardTitle>
              <CardDescription>{fixedPanel ? "Configure a imagem deste painel." : `${savedCount} painel(is) com imagem configurada.`}</CardDescription>
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
              {PANELS.map((panel) => {
                const selected = panel.id === selectedPanelId;
                const configured = settingsByPanel[panel.id]?.imageEnabled;

                return (
                  <button
                    className={[
                      "flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border px-3 text-left text-sm transition",
                      selected
                        ? "border-purple-400/50 bg-purple-500/10 text-white"
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
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {!fixedPanel ? <label className="grid gap-2 text-sm">
                <span className="font-medium text-zinc-200">Painel</span>
                <select
                  className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-purple-500/60"
                  disabled={disabled}
                  onChange={(event) => setSelectedPanelId(event.target.value)}
                  value={selectedPanelId}
                >
                  {PANELS.map((panel) => (
                    <option key={panel.id} value={panel.id}>{panel.label}</option>
                  ))}
                </select>
              </label> : null}

              <div className="grid gap-2 text-sm xl:col-span-2">
                <span className="font-medium text-zinc-200">Imagem</span>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-600">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {uploading ? "Enviando..." : "Enviar arquivo"}
                    <input
                      accept="image/gif,image/jpeg,image/png,image/webp"
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
                    className="min-h-11 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-purple-500/60"
                    disabled={disabled}
                    readOnly
                    placeholder="URL gerada pelo upload"
                    value={draft.imageUrl}
                  />
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
              <SelectField
                disabled={disabled || advancedPositions.has(draft.imagePosition)}
                label="Layout"
                onChange={(value) => updateDraft("layoutMode", value as PanelImageLayoutMode)}
                options={layoutOptions}
                value={effectiveLayoutMode}
              />
            </div>

            {draft.imageSize === "custom" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField disabled={disabled} label="Largura" onChange={(value) => updateDraft("customWidth", value)} value={draft.customWidth ?? 320} />
                <NumberField disabled={disabled} label="Altura" onChange={(value) => updateDraft("customHeight", value)} value={draft.customHeight ?? 180} />
              </div>
            ) : null}

            <div className="rounded-lg border border-zinc-900 bg-black p-4">
              <div className="mx-auto max-w-xl rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                {draft.imageEnabled && draft.imageUrl && draft.imagePosition === "top" ? (
                  <PreviewImage alt={selectedPanel.label} imageUrl={draft.imageUrl} style={previewStyle} />
                ) : null}
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-zinc-100">{selectedPanel.label}</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      Texto do painel mantendo o layout atual. A imagem segue a posicao e o tamanho selecionados.
                    </p>
                  </div>
                  {draft.imageEnabled && draft.imageUrl && draft.imagePosition === "thumbnail" ? (
                    <img alt="" className="h-20 w-20 shrink-0 rounded-md border border-zinc-800 object-cover" src={draft.imageUrl} />
                  ) : null}
                </div>
                {draft.imageEnabled && draft.imageUrl && draft.imagePosition === "below_text" ? (
                  <PreviewImage alt={selectedPanel.label} imageUrl={draft.imageUrl} style={previewStyle} />
                ) : null}
                {draft.imageEnabled && draft.imageUrl && draft.imagePosition === "above_buttons" ? (
                  <PreviewImage alt={selectedPanel.label} imageUrl={draft.imageUrl} style={previewStyle} />
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300">Botao principal</span>
                  <span className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300">Botao secundario</span>
                </div>
                {draft.imageEnabled && draft.imageUrl && draft.imagePosition === "banner" ? (
                  <PreviewImage alt={selectedPanel.label} imageUrl={draft.imageUrl} style={previewStyle} />
                ) : null}
                {draft.imageEnabled && draft.imageUrl && draft.imagePosition === "footer" ? (
                  <div className="mt-4 flex items-center gap-2 border-t border-zinc-900 pt-3 text-xs text-zinc-500">
                    <img alt="" className="h-5 w-5 rounded-full object-cover" src={draft.imageUrl} />
                    Rodape do painel
                  </div>
                ) : null}
              </div>
            </div>
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
        className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-purple-500/60"
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
        className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-purple-500/60"
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
  style
}: {
  alt: string;
  imageUrl: string;
  style: { height: string; maxWidth: string; width: string };
}) {
  return (
    <img
      alt={alt}
      className="mt-4 rounded-md border border-zinc-800 object-cover"
      src={imageUrl}
      style={style}
    />
  );
}

function defaultSettings(guildId: string, botId: string, panelId: string): PanelImageSettingsDto {
  return {
    botId,
    customHeight: null,
    customWidth: null,
    guildId,
    imageEnabled: false,
    imagePosition: "none",
    imageSize: "medium",
    imageUrl: "",
    layoutMode: "embed",
    panelId,
    updatedAt: null
  };
}

function panelLabelForId(panelId: string) {
  return PANELS.find((panel) => panel.id === panelId)?.label ?? panelId;
}

function buildPayload(settings: PanelImageSettingsDto, layoutMode: PanelImageLayoutMode): SavePanelImageSettingsPayload {
  return {
    customHeight: settings.imageSize === "custom" ? settings.customHeight : null,
    customWidth: settings.imageSize === "custom" ? settings.customWidth : null,
    imageEnabled: settings.imageEnabled,
    imagePosition: settings.imageEnabled ? settings.imagePosition : "none",
    imageSize: settings.imageSize,
    imageUrl: settings.imageEnabled ? settings.imageUrl : "",
    layoutMode
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
