import { useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { API_URL, uploadPanelImage } from "../../lib/api";
import type { PanelImageSettings } from "../../types";

type PanelMediaUrlFieldProps = {
  accept?: string;
  botId?: string | null;
  disabled?: boolean;
  guildId?: string | null;
  label: string;
  onChange: (value: string, settings?: PanelImageSettings) => void;
  onMessage?: (message: string) => void;
  panelId: string;
  type?: string;
  value: string;
};

const DEFAULT_ACCEPT = "image/png,image/jpeg,image/jpg,image/webp,image/gif,video/mp4,video/quicktime,video/webm,.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.webm";

export function PanelMediaUrlField({
  accept = DEFAULT_ACCEPT,
  botId,
  disabled,
  guildId,
  label,
  onChange,
  onMessage,
  panelId,
  type = "text",
  value
}: PanelMediaUrlFieldProps) {
  const [uploading, setUploading] = useState(false);
  const canUpload = Boolean(botId && guildId) && !disabled && type === "text";

  async function handleUpload(file: File | null | undefined) {
    if (!file || !botId || !guildId) return;
    setUploading(true);
    try {
      const saved = await uploadPanelImage(guildId, panelId, file, botId);
      onChange(saved.imageUrl, saved);
      onMessage?.("Midia enviada. Salve o painel para aplicar.");
    } catch (error) {
      onMessage?.(readError(error, "Nao foi possivel enviar a midia."));
    } finally {
      setUploading(false);
    }
  }

  return (
    <label className="block text-xs font-medium text-zinc-500">
      {label}
      <div className="mt-1 flex gap-2">
        <input
          className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]/50 disabled:opacity-60"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          type={type}
          value={value}
        />
        {type === "text" ? (
          <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-300 transition hover:border-[#FFD500]/40 disabled:opacity-50">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            <input
              accept={accept}
              className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
              disabled={!canUpload || uploading}
              onChange={(event) => {
                void handleUpload(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
              title={`Enviar ${label}`}
              type="file"
            />
          </span>
        ) : null}
      </div>
      {value ? <MediaPreview url={value} /> : null}
    </label>
  );
}

export function dashboardMediaUrl(value: string) {
  if (!value.startsWith("/api/") && !value.startsWith("/uploads/")) return value;
  try {
    const origin = new URL(API_URL).origin;
    return `${origin}${value}`;
  } catch {
    return value;
  }
}

function MediaPreview({ url }: { url: string }) {
  const src = dashboardMediaUrl(url);
  if (/\.(3gp|3g2|asf|avi|f4v|flv|m4v|mkv|mov|mp4|mpeg|mpg|mts|mxf|ogv|rmvb|ts|vob|webm|wmv)(?:$|[?#])/i.test(src)) {
    return <video className="mt-2 max-h-28 w-full rounded-md border border-zinc-800 object-contain" muted playsInline preload="metadata" src={src} />;
  }
  return <img alt="" className="mt-2 max-h-28 w-full rounded-md border border-zinc-800 object-contain" src={src} />;
}

function readError(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message
    ?? (error instanceof Error ? error.message : fallback);
}
