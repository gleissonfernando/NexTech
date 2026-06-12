import { ExternalLink, Loader2, Radio, X } from "lucide-react";
import type { LivePanelPreview } from "../../types";
import { Avatar } from "../ui/avatar";

type LivePanelPreviewModalProps = {
  loading: boolean;
  onClose: () => void;
  preview: LivePanelPreview | null;
};

export function LivePanelPreviewModal({ loading, onClose, preview }: LivePanelPreviewModalProps) {
  if (!loading && !preview) {
    return null;
  }

  const platformName = preview?.platform === "kick" ? "Kick" : "Twitch";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-4 py-8 backdrop-blur-sm">
      <div className="discord-scrollbar max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-zinc-800 bg-[#0b0b0b] p-5 shadow-[0_32px_100px_rgba(0,0,0,0.78)]">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Visualizar painel de live</h3>
            <p className="mt-1 text-sm text-zinc-500">
              Esta é a aparência aproximada da mensagem enviada ao Discord.
            </p>
          </div>
          <button
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-500 transition hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex min-h-80 items-center justify-center rounded-lg border border-zinc-800 bg-[#111214]">
            <Loader2 className="h-7 w-7 animate-spin text-zinc-400" />
          </div>
        ) : preview ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
                {platformName}
              </span>
              <span className={preview.dataSource === "live"
                ? "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300"
                : "rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200"}
              >
                {preview.dataSource === "live" ? "Dados da live atual" : "Canal offline: dados simulados"}
              </span>
            </div>

            <div className="rounded-lg bg-[#313338] p-4 text-[#dbdee1]">
              {preview.mention ? <p className="mb-2 text-sm text-[#f2f3f5]">{preview.mention}</p> : null}
              <div className="max-w-[620px] overflow-hidden rounded border-l-4 bg-[#2b2d31] p-4" style={{ borderColor: preview.color }}>
                <div className="flex items-center gap-2">
                  <Avatar className="h-6 w-6 rounded-full" fallback={platformName} src={preview.authorIconUrl} />
                  <a className="truncate text-sm font-semibold text-white hover:underline" href={preview.url} rel="noreferrer" target="_blank">
                    {preview.authorName}
                  </a>
                </div>

                <a className="mt-2 block text-base font-semibold text-[#00a8fc] hover:underline" href={preview.url} rel="noreferrer" target="_blank">
                  {preview.title}
                </a>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-[#dbdee1]">{preview.description}</p>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  {preview.fields.map((field) => (
                    <div className={field.inline ? "" : "col-span-2"} key={`${field.name}:${field.value}`}>
                      <p className="text-xs font-semibold text-[#f2f3f5]">{field.name}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-[#dbdee1]">{field.value}</p>
                    </div>
                  ))}
                </div>

                {preview.imageUrl ? (
                  <img
                    alt={`Prévia da live na ${platformName}`}
                    className="mt-4 aspect-video w-full rounded-md bg-black object-cover"
                    src={preview.imageUrl}
                  />
                ) : null}

                <p className="mt-3 text-xs text-[#949ba4]">{preview.footer}</p>
              </div>

              <a
                className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-[#4e5058] px-4 text-sm font-medium text-white transition hover:bg-[#6d6f78]"
                href={preview.url}
                rel="noreferrer"
                target="_blank"
              >
                <Radio className="h-4 w-4" />
                {preview.buttonLabel}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
